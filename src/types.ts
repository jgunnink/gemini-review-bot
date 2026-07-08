import { z } from "zod";

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_BADGE: Record<Priority, string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🟢 Low",
};

/** A single review finding emitted by the model inside the sentinel block. */
export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  end_line: z.number().int().positive().optional(),
  priority: z.enum(PRIORITIES),
  title: z.string().min(1),
  body: z.string().min(1),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** The full model output contract (see PRD §5.3). */
export const ReviewOutputSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;

/** Token counts reported by the model for a single review call. */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/** Merged adopter config (.github/gemini-review.yml) + defaults. */
export const ConfigSchema = z.object({
  model: z.string().default("gemini-flash-latest"),
  max_diff_bytes: z.number().int().positive().default(400_000),
  ignore: z.array(z.string()).default([]),
  instructions: z.string().optional(),
});
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_IGNORES = [
  "**/package-lock.json",
  "**/yarn.lock",
  "**/pnpm-lock.yaml",
  "**/*.lock",
  "**/dist/**",
  "**/build/**",
  "**/*.min.js",
  "**/vendor/**",
  "**/*.snap",
  "**/go.sum",
];

/** A changed file in the PR after ignore/cap filtering. */
export interface DiffFile {
  path: string;
  patch: string; // unified diff hunk for this file
}
