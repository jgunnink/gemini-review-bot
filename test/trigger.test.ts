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

  describe("pull_request_review_comment", () => {
    it("runs on /gemini command in review comment from a member", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 101,
          body: "/gemini can you suggest an async alternative?",
          author_association: "COLLABORATOR",
          user: { login: "alice", type: "User" },
        },
      };
      const d = decideTrigger();
      expect(d.run).toBe(true);
      expect(d.type).toBe("thread_reply");
      expect(d.prNumber).toBe(15);
      expect(d.reviewCommentId).toBe(101);
      expect(d.inReplyToId).toBeUndefined();
      expect(d.question).toBe("can you suggest an async alternative?");
    });

    it("runs on /gemini-review command with thread in_reply_to_id", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 102,
          in_reply_to_id: 88,
          body: "/gemini-review why is this flagged?",
          author_association: "MEMBER",
          user: { login: "bob", type: "User" },
        },
      };
      const d = decideTrigger();
      expect(d.run).toBe(true);
      expect(d.type).toBe("thread_reply");
      expect(d.reviewCommentId).toBe(102);
      expect(d.inReplyToId).toBe(88);
      expect(d.question).toBe("why is this flagged?");
    });

    it("runs on @gemini mention", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 103,
          body: "@gemini please check this logic",
          author_association: "OWNER",
          user: { login: "carol", type: "User" },
        },
      };
      const d = decideTrigger();
      expect(d.run).toBe(true);
      expect(d.question).toBe("please check this logic");
    });

    it("skips review comments without /gemini command", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 104,
          body: "Looks good to me!",
          author_association: "MEMBER",
          user: { login: "alice", type: "User" },
        },
      };
      expect(decideTrigger().run).toBe(false);
    });

    it("skips comments posted by bots to prevent feedback loops", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 105,
          body: "/gemini response",
          author_association: "COLLABORATOR",
          user: { login: "github-actions[bot]", type: "Bot" },
        },
      };
      expect(decideTrigger().run).toBe(false);
    });

    it("skips comments on fork PRs", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "created",
        pull_request: { number: 15, head: { repo: { fork: true } } },
        comment: {
          id: 106,
          body: "/gemini help",
          author_association: "COLLABORATOR",
          user: { login: "alice", type: "User" },
        },
      };
      expect(decideTrigger().run).toBe(false);
    });

    it("skips non-created actions (e.g. edited, deleted)", () => {
      ctx.eventName = "pull_request_review_comment";
      ctx.payload = {
        action: "deleted",
        pull_request: { number: 15, head: { repo: { fork: false } } },
        comment: {
          id: 107,
          body: "/gemini help",
          author_association: "COLLABORATOR",
          user: { login: "alice", type: "User" },
        },
      };
      expect(decideTrigger().run).toBe(false);
    });
  });
});
