import { describe, it, expect, vi } from "vitest";
import { filterDiff, extractDiffLineNumbers } from "../src/diff.ts";
import type { Config } from "../src/types.ts";

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
}));

describe("filterDiff", () => {
  const defaultConfig: Config = {
    model: "gemini-flash-latest",
    max_diff_bytes: 400_000,
    ignore: [],
  };

  it("keeps valid files and skips removed or patch-less files", () => {
    const prFiles = [
      { filename: "added.ts", patch: "hunk1", status: "added" },
      { filename: "removed.ts", patch: "hunk2", status: "removed" },
      { filename: "nopatch.ts", status: "modified" },
    ];
    const res = filterDiff(prFiles, defaultConfig);
    expect(res.files).toEqual([{ path: "added.ts", patch: "hunk1" }]);
    expect(res.note).toBeUndefined();
  });

  it("filters out files matching ignore globs", () => {
    const prFiles = [
      { filename: "src/main.ts", patch: "content1", status: "modified" },
      { filename: "docs/readme.md", patch: "content2", status: "modified" },
    ];
    const config = { ...defaultConfig, ignore: ["docs/**"] };
    const res = filterDiff(prFiles, config);
    expect(res.files).toEqual([{ path: "src/main.ts", patch: "content1" }]);
    expect(res.note).toBe("Ignored 1 file(s) via ignore globs.");
  });

  it("skips review if total patch size exceeds max_diff_bytes", () => {
    const prFiles = [
      { filename: "large.ts", patch: "a".repeat(100), status: "modified" },
    ];
    const config = { ...defaultConfig, max_diff_bytes: 50 };
    const res = filterDiff(prFiles, config);
    expect(res.files).toEqual([]);
    expect(res.note).toContain("exceeds max_diff_bytes=50");
  });

  it("does not restrict the number of files (no max_files limit)", () => {
    // Generate 60 files (exceeding the old default limit of 50)
    const prFiles = Array.from({ length: 60 }, (_, i) => ({
      filename: `file_${i}.ts`,
      patch: `patch_${i}`,
      status: "modified",
    }));
    const res = filterDiff(prFiles, defaultConfig);
    expect(res.files).toHaveLength(60);
    expect(res.note).toBeUndefined();
  });
});

describe("extractDiffLineNumbers", () => {
  it("extracts only lines that are part of the new-side diff hunks", () => {
    const patch = `@@ -10,3 +20,4 @@
 context 1
-removed
+added 1
+added 2
 context 2`;

    const validLines = extractDiffLineNumbers(patch);
    expect(validLines.has(20)).toBe(true); // context 1
    expect(validLines.has(21)).toBe(true); // added 1
    expect(validLines.has(22)).toBe(true); // added 2
    expect(validLines.has(23)).toBe(true); // context 2
    // Unchanged lines outside the hunk are not present
    expect(validLines.has(19)).toBe(false);
    expect(validLines.has(24)).toBe(false);
    expect(validLines.has(59)).toBe(false);
  });

  it("handles multi-hunk diffs with gaps between hunks", () => {
    const patch = `@@ -1,2 +5,2 @@
 context 1
+added 1
@@ -10,2 +50,2 @@
 context 2
+added 2`;

    const validLines = extractDiffLineNumbers(patch);
    expect(validLines.has(5)).toBe(true);
    expect(validLines.has(6)).toBe(true);
    // Gap between line 7 and 49 should be false
    expect(validLines.has(7)).toBe(false);
    expect(validLines.has(25)).toBe(false);
    expect(validLines.has(49)).toBe(false);
    // Second hunk
    expect(validLines.has(50)).toBe(true);
    expect(validLines.has(51)).toBe(true);
  });
});

