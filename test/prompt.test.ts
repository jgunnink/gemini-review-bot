import { describe, it, expect } from "vitest";
import { annotatePatch, buildPrompt } from "../src/prompt.ts";
import type { Config, DiffFile } from "../src/types.ts";

describe("annotatePatch", () => {
  it("annotates new-side line numbers correctly", () => {
    const patch = `@@ -10,4 +20,5 @@
 context line 1
-removed line
+added line 1
+added line 2
 context line 2`;

    const annotated = annotatePatch(patch);
    const lines = annotated.split("\n");

    expect(lines[0]).toBe("@@ -10,4 +20,5 @@");
    expect(lines[1]).toBe("   20  context line 1");
    expect(lines[2]).toBe("      -removed line");
    expect(lines[3]).toBe("   21 +added line 1");
    expect(lines[4]).toBe("   22 +added line 2");
    expect(lines[5]).toBe("   23  context line 2");
  });

  it("handles multiple hunks resetting line numbers", () => {
    const patch = `@@ -1,2 +5,2 @@
 context 1
+added 1
@@ -10,2 +50,2 @@
 context 2
+added 2`;

    const annotated = annotatePatch(patch);
    const lines = annotated.split("\n");

    expect(lines[0]).toBe("@@ -1,2 +5,2 @@");
    expect(lines[1]).toBe("    5  context 1");
    expect(lines[2]).toBe("    6 +added 1");
    expect(lines[3]).toBe("@@ -10,2 +50,2 @@");
    expect(lines[4]).toBe("   50  context 2");
    expect(lines[5]).toBe("   51 +added 2");
  });

  it("handles no newline at end of file marker", () => {
    const patch = `@@ -1,2 +1,2 @@
-old
\\ No newline at end of file
+new
\\ No newline at end of file`;

    const annotated = annotatePatch(patch);
    const lines = annotated.split("\n");

    expect(lines[1]).toBe("      -old");
    expect(lines[2]).toBe("      \\ No newline at end of file");
    expect(lines[3]).toBe("    1 +new");
    expect(lines[4]).toBe("      \\ No newline at end of file");
  });
});

describe("buildPrompt", () => {
  const baseConfig: Config = {
    model: "gemini-flash-latest",
    max_diff_bytes: 400_000,
    ignore: [],
    max_findings: 5,
  };

  const sampleFiles: DiffFile[] = [
    {
      path: "src/auth.ts",
      patch: `@@ -1,2 +1,3 @@
 const a = 1;
+const token = "secret";
 const b = 2;`,
    },
  ];

  it("returns systemInstruction and contents with dynamic nonce tags", () => {
    const prompt = buildPrompt(sampleFiles, baseConfig, "Add auth", "Fixes login");

    expect(prompt.systemInstruction).toBeDefined();
    expect(prompt.contents).toBeDefined();

    // Verify system instruction contains priority rubric and rules
    expect(prompt.systemInstruction).toContain("PRIORITY RUBRIC:");
    expect(prompt.systemInstruction).toContain("SECURITY & UNTRUSTED DATA:");
    expect(prompt.systemInstruction).toContain("maximum 5");
    expect(prompt.systemInstruction).toContain("prompt-injection attempt");
    expect(prompt.systemInstruction).toContain("NEVER copy the line number prefix");

    // Verify contents contains tagged blocks
    expect(prompt.contents).toMatch(/<pr_title_[a-f0-9]{8}>/);
    expect(prompt.contents).toMatch(/<pr_body_[a-f0-9]{8}>/);
    expect(prompt.contents).toMatch(/<diff_[a-f0-9]{8}>/);
    expect(prompt.contents).toContain("Add auth");
    expect(prompt.contents).toContain("Fixes login");
    expect(prompt.contents).toContain('<file path="src/auth.ts">');
    expect(prompt.contents).toContain('   2 +const token = "secret";');
  });

  it("includes repo-specific guidance when config.instructions is set", () => {
    const configWithInstructions: Config = {
      ...baseConfig,
      instructions: "Flag all missing docstrings.",
    };

    const prompt = buildPrompt(sampleFiles, configWithInstructions, "PR", "");
    expect(prompt.systemInstruction).toContain("REPO-SPECIFIC GUIDANCE");
    expect(prompt.systemInstruction).toContain("Flag all missing docstrings.");
  });
});
