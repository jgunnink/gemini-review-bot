import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable context the mocked @actions/github reads from.
const ctx: { eventName: string; payload: any } = { eventName: "", payload: {} };
vi.mock("@actions/github", () => ({
  get context() {
    return ctx;
  },
}));

const { decideTrigger } = await import("../src/trigger.ts");

beforeEach(() => {
  ctx.eventName = "";
  ctx.payload = {};
});

describe("decideTrigger", () => {
  it("runs on pull_request opened without a commentId", () => {
    ctx.eventName = "pull_request";
    ctx.payload = { pull_request: { number: 7, head: { repo: { fork: false } } } };
    const d = decideTrigger();
    expect(d.run).toBe(true);
    expect(d.prNumber).toBe(7);
    expect(d.commentId).toBeUndefined();
  });

  it("returns the commentId on a /gemini-review command from a member", () => {
    ctx.eventName = "issue_comment";
    ctx.payload = {
      comment: { id: 42, body: "/gemini-review", author_association: "MEMBER" },
      issue: { number: 9, pull_request: {} },
    };
    const d = decideTrigger();
    expect(d.run).toBe(true);
    expect(d.prNumber).toBe(9);
    expect(d.commentId).toBe(42);
  });

  it("does not run for an unauthorized author", () => {
    ctx.eventName = "issue_comment";
    ctx.payload = {
      comment: { id: 42, body: "/gemini-review", author_association: "NONE" },
      issue: { number: 9, pull_request: {} },
    };
    expect(decideTrigger().run).toBe(false);
  });
});
