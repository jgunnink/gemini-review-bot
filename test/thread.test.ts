import { describe, it, expect } from "vitest";
import { buildThreadPrompt } from "../src/prompt.ts";
import { extractReviewCommentQuestion } from "../src/trigger.ts";
import type { Config, ThreadMessage } from "../src/types.ts";

describe("extractReviewCommentQuestion", () => {
  it("strips leading /gemini command", () => {
    expect(extractReviewCommentQuestion("/gemini what does this do?")).toBe("what does this do?");
  });

  it("strips leading /gemini-review command with colon", () => {
    expect(extractReviewCommentQuestion("/gemini-review: why is this flagged?")).toBe(
      "why is this flagged?"
    );
  });

  it("strips leading @gemini mention", () => {
    expect(extractReviewCommentQuestion("@gemini how can I improve performance?")).toBe(
      "how can I improve performance?"
    );
  });

  it("falls back to default request when command is empty", () => {
    expect(extractReviewCommentQuestion("/gemini")).toBe(
      "Please review this code and provide feedback or suggestions."
    );
    expect(extractReviewCommentQuestion("/gemini-review")).toBe(
      "Please review this code and provide feedback or suggestions."
    );
  });
});

describe("buildThreadPrompt", () => {
  const baseConfig: Config = {
    model: "gemini-flash-latest",
    max_diff_bytes: 400_000,
    ignore: [],
  };

  it("builds prompt with previous thread comments", () => {
    const thread: ThreadMessage[] = [
      { author: "bot", isBot: true, body: "🔴 Critical — Possible SQL Injection" },
      { author: "alice", isBot: false, body: "Could you provide a parameterized query example?" },
    ];

    const prompt = buildThreadPrompt({
      filePath: "src/db.ts",
      diffHunk: "@@ -10,3 +10,3 @@\n- query(raw)\n+ query(`SELECT * FROM users WHERE id = ${id}`)",
      thread,
      userQuestion: "Could you provide a parameterized query example?",
      config: baseConfig,
      prTitle: "Add user lookup",
      prBody: "Fetches user by id",
    });

    expect(prompt).toContain("FILE: src/db.ts");
    expect(prompt).toContain("query(`SELECT * FROM users WHERE id = ${id}`)");
    expect(prompt).toContain("[Bot]: 🔴 Critical — Possible SQL Injection");
    expect(prompt).toContain("[alice]: Could you provide a parameterized query example?");
    expect(prompt).toContain("DEVELOPER QUESTION / REQUEST:\nCould you provide a parameterized query example?");
    expect(prompt).toContain("```suggestion");
  });

  it("builds prompt without previous thread comments for new diff line inquiries", () => {
    const prompt = buildThreadPrompt({
      filePath: "src/auth.ts",
      diffHunk: "@@ -20,2 +20,4 @@\n+ const token = sign(payload);",
      thread: [],
      userQuestion: "Is the token expiration safe here?",
      config: { ...baseConfig, instructions: "Prefer JWT with RS256" },
      prTitle: "Auth setup",
      prBody: "Adds token signing",
    });

    expect(prompt).toContain("FILE: src/auth.ts");
    expect(prompt).not.toContain("PREVIOUS THREAD COMMENTS");
    expect(prompt).toContain("ADDITIONAL REVIEW CRITERIA");
    expect(prompt).toContain("Prefer JWT with RS256");
    expect(prompt).toContain("DEVELOPER QUESTION / REQUEST:\nIs the token expiration safe here?");
  });
});
