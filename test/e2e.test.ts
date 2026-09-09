import { describe, it, expect } from "vitest";
import { resolveAuth } from "../src/auth.ts";
import { runReview } from "../src/gemini.ts";
import { buildPrompt } from "../src/prompt.ts";

const agentKey = process.env.AGENT_PLATFORM_KEY || process.env.AGENT_PLATFORM_API_KEY;

describe.skipIf(!agentKey)("Live Vertex AI E2E", () => {
  it("executes a live review against Vertex AI endpoints", async () => {
    const auth = resolveAuth(process.env.GEMINI_API_KEY, agentKey);
    expect(auth.useVertex).toBe(true);

    const diffFiles = [
      {
        path: "src/math.ts",
        patch:
          "@@ -0,0 +1,3 @@\n+export function add(a: number, b: number) {\n+  return a + b;\n+}\n",
      },
    ];
    const config = {
      model: "gemini-flash-latest",
      max_diff_bytes: 400000,
      ignore: [],
    };
    const prompt = buildPrompt(diffFiles, config, "Add math helper", "PR body");
    const review = await runReview(prompt, config.model, auth.apiKey, auth.useVertex);

    expect(review.summary).toBeDefined();
    expect(typeof review.summary).toBe("string");
    expect(Array.isArray(review.findings)).toBe(true);
    expect(review.usage?.total).toBeGreaterThan(0);
  }, 30000);
});
