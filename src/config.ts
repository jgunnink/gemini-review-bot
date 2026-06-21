import { readFileSync, existsSync } from "node:fs";
import * as core from "@actions/core";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, DEFAULT_IGNORES, type Config } from "./types";

/**
 * Load `.github/gemini-review.yml` (if present), merge over defaults, and apply the
 * action-level model override. Default ignore globs always apply.
 */
export function loadConfig(configPath: string, modelOverride: string): Config {
  let fromFile: unknown = {};
  if (existsSync(configPath)) {
    try {
      fromFile = parseYaml(readFileSync(configPath, "utf8")) ?? {};
    } catch (e) {
      core.warning(`Could not parse ${configPath}: ${(e as Error).message}. Using defaults.`);
    }
  }

  const parsed = ConfigSchema.safeParse(fromFile);
  const config = parsed.success ? parsed.data : ConfigSchema.parse({});
  if (!parsed.success) core.warning("Config failed validation; using defaults.");

  // Merge default ignores with adopter ignores (union).
  config.ignore = Array.from(new Set([...DEFAULT_IGNORES, ...config.ignore]));

  // Action input overrides config file.
  if (modelOverride.trim()) config.model = modelOverride.trim();

  return config;
}
