import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

vi.mock("@actions/core", () => ({
  warning: vi.fn(),
}));

describe("loadConfig", () => {
  const dirs: string[] = [];

  function writeConfig(yaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), "gemini-review-"));
    dirs.push(dir);
    const path = join(dir, "gemini-review.yml");
    writeFileSync(path, yaml);
    return path;
  }

  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });

  it("returns defaults when the config file is missing", () => {
    const config = loadConfig("/nonexistent/gemini-review.yml", "");
    expect(config.model).toBe("gemini-flash-latest");
    expect(config.instructions).toBeUndefined();
    expect(config.ignore).toContain("**/package-lock.json");
  });

  it("reads instructions from the config file", () => {
    const path = writeConfig("instructions: Flag untested modules.\n");
    const config = loadConfig(path, "");
    expect(config.instructions).toBe("Flag untested modules.");
  });

  it("applies the instructions action input when there is no config file", () => {
    const config = loadConfig("/nonexistent/gemini-review.yml", "", "Do not flag docs.");
    expect(config.instructions).toBe("Do not flag docs.");
  });

  it("lets action inputs override the config file", () => {
    const path = writeConfig("model: gemini-pro-latest\ninstructions: From file.\n");
    const config = loadConfig(path, "gemini-flash-latest", "From input.");
    expect(config.model).toBe("gemini-flash-latest");
    expect(config.instructions).toBe("From input.");
  });

  it("keeps config-file instructions when the input is blank", () => {
    const path = writeConfig("instructions: From file.\n");
    const config = loadConfig(path, "", "  ");
    expect(config.instructions).toBe("From file.");
  });
});
