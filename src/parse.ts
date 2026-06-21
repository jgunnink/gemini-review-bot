import * as core from "@actions/core";
import { FindingSchema, ReviewOutputSchema, type Finding, type ReviewOutput } from "./types.ts";

/**
 * Validate the model's JSON output. With Gemini's responseSchema the shape is
 * already constrained, but we still validate defensively and salvage individual
 * findings so one bad entry can't discard the whole review.
 */
export function parseReview(jsonText: string): ReviewOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Model did not return valid JSON: ${(e as Error).message}`);
  }

  const envelope = ReviewOutputSchema.safeParse(parsed);
  if (envelope.success) return envelope.data;

  const obj = (parsed ?? {}) as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const findings: Finding[] = [];
  for (const f of Array.isArray(obj.findings) ? obj.findings : []) {
    const res = FindingSchema.safeParse(f);
    if (res.success) findings.push(res.data);
    else core.warning(`Dropping malformed finding: ${JSON.stringify(f).slice(0, 200)}`);
  }
  return { summary, findings };
}
