import { describe, it, expect, vi } from "vitest";
import { filterDiff } from "../src/diff.ts";
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
