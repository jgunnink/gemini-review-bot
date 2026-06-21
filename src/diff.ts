import * as core from "@actions/core";
import { minimatch } from "./minimatch";
import type { Config, DiffFile } from "./types";

interface PrFile {
  filename: string;
  patch?: string;
  status: string;
}

/**
 * Filter PR files by ignore globs and enforce size caps.
 * Returns the files to review, plus a note if anything was capped/skipped.
 */
export function filterDiff(
  prFiles: PrFile[],
  config: Config
): { files: DiffFile[]; note?: string } {
  const kept: DiffFile[] = [];
  let ignored = 0;

  for (const f of prFiles) {
    if (f.status === "removed" || !f.patch) continue;
    if (config.ignore.some((g) => minimatch(f.filename, g))) {
      ignored++;
      continue;
    }
    kept.push({ path: f.filename, patch: f.patch });
  }

  if (kept.length > config.max_files) {
    const note = `Skipped review: ${kept.length} changed files exceeds max_files=${config.max_files}.`;
    core.warning(note);
    return { files: [], note };
  }

  const totalBytes = kept.reduce((n, f) => n + Buffer.byteLength(f.patch), 0);
  if (totalBytes > config.max_diff_bytes) {
    const note = `Skipped review: diff ${totalBytes}B exceeds max_diff_bytes=${config.max_diff_bytes}.`;
    core.warning(note);
    return { files: [], note };
  }

  const note = ignored > 0 ? `Ignored ${ignored} file(s) via ignore globs.` : undefined;
  return { files: kept, note };
}
