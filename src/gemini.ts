import * as core from "@actions/core";
import { GoogleGenAI, Type } from "@google/genai";
import { parseReview } from "./parse.ts";
import type { ReviewOutput, ReviewPrompt, TokenUsage } from "./types.ts";

/**
 * Native structured-output schema. Gemini's JSON mode constrains the model to
 * exactly this shape, so we get parseable JSON without the old sentinel hack.
 */
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    findings: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          file: { type: Type.STRING },
          line: { type: Type.INTEGER },
          end_line: { type: Type.INTEGER },
          priority: { type: Type.STRING, enum: ["critical", "high", "medium", "low"] },
          title: { type: Type.STRING },
          body: { type: Type.STRING },
          suggestion: { type: Type.STRING },
        },
        required: ["file", "line", "priority", "title", "body"],
        propertyOrdering: ["file", "line", "end_line", "priority", "title", "body", "suggestion"],
      },
    },
  },
  required: ["summary", "findings"],
};

const MAX_RETRIES = 3;

/** Backoff before each retry, indexed by attempt (1st retry waits 10s, 2nd waits 30s). */
const RETRY_BACKOFFS_MS = [10_000, 30_000];

/** Run the review against the Gemini API (or Vertex AI endpoints) and return validated findings plus token usage. */
export async function runReview(
  prompt: string | ReviewPrompt,
  model: string,
  apiKey: string,
  useVertex = false
): Promise<ReviewOutput & { usage?: TokenUsage }> {
  // 'gemini-flash-latest' is an AI Studio alias; on Vertex AI map it to 'gemini-2.5-flash'.
  const targetModel =
    useVertex && model === "gemini-flash-latest" ? "gemini-2.5-flash" : model;
  const ai = new GoogleGenAI({ apiKey, vertexai: useVertex });
  const contents = typeof prompt === "string" ? prompt : prompt.contents;
  const systemInstruction = typeof prompt === "string" ? undefined : prompt.systemInstruction;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: targetModel,
        contents,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema,
        },
      });
      const text = res.text ?? "";
      if (!text.trim()) throw new Error("Empty response from Gemini.");
      // Only attach usage when the API actually reports it; otherwise a 0/0/0
      // footer would misleadingly imply no tokens were spent.
      const meta = res.usageMetadata;
      const usage: TokenUsage | undefined = meta
        ? {
            input: meta.promptTokenCount ?? 0,
            output: meta.candidatesTokenCount ?? 0,
            total: meta.totalTokenCount ?? 0,
          }
        : undefined;
      return { ...parseReview(text), usage };
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const retryable = status === 429 || status === 503 || status === 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoffMs = RETRY_BACKOFFS_MS[attempt - 1] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1];
      core.warning(`Gemini call failed (status ${status}); retry ${attempt}/${MAX_RETRIES} in ${backoffMs}ms.`);
      await sleep(backoffMs);
    }
  }
  throw new Error(`Gemini request failed: ${(lastErr as Error)?.message ?? String(lastErr)}`);
}

/** Run a conversational Q&A reply for an inline review comment using Gemini. */
export async function runThreadReply(
  prompt: string,
  model: string,
  apiKey: string,
  useVertex = false
): Promise<{ reply: string; usage?: TokenUsage }> {
  const targetModel =
    useVertex && model === "gemini-flash-latest" ? "gemini-2.5-flash" : model;
  const ai = new GoogleGenAI({ apiKey, vertexai: useVertex });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: targetModel,
        contents: prompt,
      });
      const text = res.text ?? "";
      if (!text.trim()) throw new Error("Empty response from Gemini.");
      const meta = res.usageMetadata;
      const usage: TokenUsage | undefined = meta
        ? {
            input: meta.promptTokenCount ?? 0,
            output: meta.candidatesTokenCount ?? 0,
            total: meta.totalTokenCount ?? 0,
          }
        : undefined;
      return { reply: text.trim(), usage };
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const retryable = status === 429 || status === 503 || status === 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoffMs = RETRY_BACKOFFS_MS[attempt - 1] ?? RETRY_BACKOFFS_MS[RETRY_BACKOFFS_MS.length - 1];
      core.warning(`Gemini call failed (status ${status}); retry ${attempt}/${MAX_RETRIES} in ${backoffMs}ms.`);
      await sleep(backoffMs);
    }
  }
  throw new Error(`Gemini request failed: ${(lastErr as Error)?.message ?? String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

