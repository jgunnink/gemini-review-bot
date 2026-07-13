import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, DEFAULT_IGNORES, type Config } from "./types.ts";

/**
 * Load `.github/gemini-review.yml` (if present), merge over defaults, and apply the
 * action-level model/instructions overrides. Default ignore globs always apply.
 *
 * The config path is resolved against the checked-out repo (GITHUB_WORKSPACE) so it
 * works regardless of the process cwd (the composite action runs node from the action dir).
 */
export function loadConfig(configPath: string, modelOverride: string, instructionsOverride = ""): Config {
  const workspace = process.env.GITHUB_WORKSPACE;
  const resolved = isAbsolute(configPath) || !workspace ? configPath : join(workspace, configPath);

  let fromFile: unknown = {};
  if (existsSync(resolved)) {
    try {
      fromFile = parseYaml(readFileSync(resolved, "utf8")) ?? {};
    } catch (e) {
      core.warning(`Could not parse ${resolved}: ${(e as Error).message}. Using defaults.`);
    }
  }

  const parsed = ConfigSchema.safeParse(fromFile);
  const config = parsed.success ? parsed.data : ConfigSchema.parse({});
  if (!parsed.success) core.warning("Config failed validation; using defaults.");

  // Merge default ignores with adopter ignores (union).
  config.ignore = Array.from(new Set([...DEFAULT_IGNORES, ...config.ignore]));

  // Action inputs override the config file.
  if (modelOverride.trim()) config.model = modelOverride.trim();
  if (instructionsOverride.trim()) config.instructions = instructionsOverride.trim();

  return config;
}
