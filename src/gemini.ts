import * as core from "@actions/core";
import { GoogleGenAI, Type } from "@google/genai";
import { parseReview } from "./parse";
import type { ReviewOutput } from "./types";

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

/** Run the review against the Gemini API and return validated findings. */
export async function runReview(prompt: string, model: string, apiKey: string): Promise<ReviewOutput> {
  const ai = new GoogleGenAI({ apiKey });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json", responseSchema },
      });
      const text = res.text ?? "";
      if (!text.trim()) throw new Error("Empty response from Gemini.");
      return parseReview(text);
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const retryable = status === 429 || status === 503 || status === 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      const backoffMs = 2000 * attempt;
      core.warning(`Gemini call failed (status ${status}); retry ${attempt}/${MAX_RETRIES} in ${backoffMs}ms.`);
      await sleep(backoffMs);
    }
  }
  throw new Error(`Gemini request failed: ${(lastErr as Error)?.message ?? String(lastErr)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
