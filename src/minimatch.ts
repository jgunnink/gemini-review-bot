/**
 * Tiny glob matcher for ignore patterns — supports `**`, `*`, and literal paths.
 * Kept dependency-free; replace with the `minimatch` package if richer globs are needed.
 */
export function minimatch(path: string, pattern: string): boolean {
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials except * and /
        .replace(/\*\*\//g, "(?:.*/)?") // **/ => optional any-dirs
        .replace(/\*\*/g, ".*") // ** => any
        .replace(/\*/g, "[^/]*") + // * => any non-slash
      "$"
  );
  return re.test(path);
}
