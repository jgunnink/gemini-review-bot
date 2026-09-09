import { describe, it, expect, vi } from "vitest";
import { postReview, acknowledgeRequest, completeRequest, type ReactionRef } from "../src/github.ts";
import type { Finding, DiffFile } from "../src/types.ts";

vi.mock("@actions/core", () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

describe("postReview line validation and fallback", () => {
  const files: DiffFile[] = [
    {
      path: "src/sample.ts",
      patch: `@@ -10,2 +20,3 @@
 context
+added 1
+added 2`,
    },
  ];

  it("posts valid inline comments and separates out-of-diff lines into summary", async () => {
    const findings: Finding[] = [
      {
        file: "src/sample.ts",
        line: 21, // Valid line in hunk
        priority: "high",
        title: "Valid Finding",
        body: "Looks good",
      },
      {
        file: "src/sample.ts",
        line: 59, // Out of diff hunk!
        priority: "low",
        title: "Out of Hunk Finding",
        body: "Should be in summary",
      },
    ];

    const createReviewMock = vi.fn().mockResolvedValue({});
    const listCommentsMock = vi.fn().mockResolvedValue({ data: [] });
    const createCommentMock = vi.fn().mockResolvedValue({});

    const octokit = {
      rest: {
        pulls: {
          createReview: createReviewMock,
        },
        issues: {
          listComments: listCommentsMock,
          createComment: createCommentMock,
        },
      },
    } as any;

    await postReview({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 1,
      commitId: "sha-123",
      summary: "Review Summary",
      findings,
      files,
    });

    // createReview must only be called with the valid line (line 21), not line 59
    expect(createReviewMock).toHaveBeenCalledTimes(1);
    const commentsPayload = createReviewMock.mock.calls[0][0].comments;
    expect(commentsPayload).toHaveLength(1);
    expect(commentsPayload[0].line).toBe(21);
    expect(commentsPayload[0].side).toBe("RIGHT");

    // The summary comment must include the out-of-diff finding
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    const summaryBody = createCommentMock.mock.calls[0][0].body;
    expect(summaryBody).toContain("1 finding(s) outside the diff");
    expect(summaryBody).toContain("Out of Hunk Finding");
  });

  it("retries individual comments if batch createReview fails", async () => {
    const findings: Finding[] = [
      {
        file: "src/sample.ts",
        line: 21,
        priority: "medium",
        title: "Finding 1",
        body: "First",
      },
      {
        file: "src/sample.ts",
        line: 22,
        priority: "medium",
        title: "Finding 2",
        body: "Second",
      },
    ];

    const createReviewMock = vi.fn().mockRejectedValue(new Error("Line could not be resolved"));
    const createReviewCommentMock = vi
      .fn()
      .mockResolvedValueOnce({}) // first comment succeeds
      .mockRejectedValueOnce(new Error("Line could not be resolved")); // second comment fails
    const listCommentsMock = vi.fn().mockResolvedValue({ data: [] });
    const createCommentMock = vi.fn().mockResolvedValue({});

    const octokit = {
      rest: {
        pulls: {
          createReview: createReviewMock,
          createReviewComment: createReviewCommentMock,
        },
        issues: {
          listComments: listCommentsMock,
          createComment: createCommentMock,
        },
      },
    } as any;

    await postReview({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 1,
      commitId: "sha-123",
      summary: "Summary",
      findings,
      files,
    });

    expect(createReviewMock).toHaveBeenCalledTimes(1);
    // Both comments retried individually
    expect(createReviewCommentMock).toHaveBeenCalledTimes(2);

    // The one that failed individual posting is folded into the summary
    expect(createCommentMock).toHaveBeenCalledTimes(1);
    const summaryBody = createCommentMock.mock.calls[0][0].body;
    expect(summaryBody).toContain("1 finding(s) outside the diff");
    expect(summaryBody).toContain("Finding 2");
  });
});

describe("acknowledgeRequest", () => {
  it("creates an eyes reaction on a pull request review comment", async () => {
    const createForPullRequestReviewComment = vi.fn().mockResolvedValue({ data: { id: 101 } });
    const octokit = {
      rest: {
        reactions: {
          createForPullRequestReviewComment,
        },
      },
    } as any;

    const res = await acknowledgeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 42,
      reviewCommentId: 123,
    });

    expect(createForPullRequestReviewComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 123,
      content: "eyes",
    });
    expect(res).toEqual({
      reactionId: 101,
      type: "pull_request_review_comment",
      targetId: 123,
    });
  });

  it("creates an eyes reaction on an issue comment", async () => {
    const createForIssueComment = vi.fn().mockResolvedValue({ data: { id: 202 } });
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment,
        },
      },
    } as any;

    const res = await acknowledgeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 42,
      commentId: 456,
    });

    expect(createForIssueComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 456,
      content: "eyes",
    });
    expect(res).toEqual({
      reactionId: 202,
      type: "issue_comment",
      targetId: 456,
    });
  });

  it("creates an eyes reaction on the PR issue itself", async () => {
    const createForIssue = vi.fn().mockResolvedValue({ data: { id: 303 } });
    const octokit = {
      rest: {
        reactions: {
          createForIssue,
        },
      },
    } as any;

    const res = await acknowledgeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 42,
    });

    expect(createForIssue).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      content: "eyes",
    });
    expect(res).toEqual({
      reactionId: 303,
      type: "issue",
      targetId: 42,
    });
  });

  it("handles reaction failure gracefully without throwing", async () => {
    const createForIssue = vi.fn().mockRejectedValue(new Error("API rate limit exceeded"));
    const octokit = {
      rest: {
        reactions: {
          createForIssue,
        },
      },
    } as any;

    const res = await acknowledgeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      prNumber: 42,
    });

    expect(createForIssue).toHaveBeenCalledTimes(1);
    expect(res).toBeUndefined();
  });
});

describe("completeRequest", () => {
  it("removes eyes reaction and adds +1 on a pull request review comment", async () => {
    const deleteForPullRequestComment = vi.fn().mockResolvedValue({});
    const createForPullRequestReviewComment = vi.fn().mockResolvedValue({ data: { id: 999 } });
    const octokit = {
      rest: {
        reactions: {
          deleteForPullRequestComment,
          createForPullRequestReviewComment,
        },
      },
    } as any;

    const reaction: ReactionRef = {
      reactionId: 101,
      type: "pull_request_review_comment",
      targetId: 123,
    };

    await completeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      reaction,
    });

    expect(deleteForPullRequestComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 123,
      reaction_id: 101,
    });
    expect(createForPullRequestReviewComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 123,
      content: "+1",
    });
  });

  it("removes eyes reaction and adds +1 on an issue comment", async () => {
    const deleteForIssueComment = vi.fn().mockResolvedValue({});
    const createForIssueComment = vi.fn().mockResolvedValue({ data: { id: 888 } });
    const octokit = {
      rest: {
        reactions: {
          deleteForIssueComment,
          createForIssueComment,
        },
      },
    } as any;

    const reaction: ReactionRef = {
      reactionId: 202,
      type: "issue_comment",
      targetId: 456,
    };

    await completeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      reaction,
    });

    expect(deleteForIssueComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 456,
      reaction_id: 202,
    });
    expect(createForIssueComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 456,
      content: "+1",
    });
  });

  it("removes eyes reaction and adds +1 on the PR issue", async () => {
    const deleteForIssue = vi.fn().mockResolvedValue({});
    const createForIssue = vi.fn().mockResolvedValue({ data: { id: 777 } });
    const octokit = {
      rest: {
        reactions: {
          deleteForIssue,
          createForIssue,
        },
      },
    } as any;

    const reaction: ReactionRef = {
      reactionId: 303,
      type: "issue",
      targetId: 42,
    };

    await completeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      reaction,
    });

    expect(deleteForIssue).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      reaction_id: 303,
    });
    expect(createForIssue).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      content: "+1",
    });
  });

  it("still adds +1 even if deleting eyes reaction fails", async () => {
    const deleteForIssue = vi.fn().mockRejectedValue(new Error("Reaction not found"));
    const createForIssue = vi.fn().mockResolvedValue({ data: { id: 777 } });
    const octokit = {
      rest: {
        reactions: {
          deleteForIssue,
          createForIssue,
        },
      },
    } as any;

    const reaction: ReactionRef = {
      reactionId: 303,
      type: "issue",
      targetId: 42,
    };

    await completeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      reaction,
    });

    expect(deleteForIssue).toHaveBeenCalledTimes(1);
    expect(createForIssue).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: 42,
      content: "+1",
    });
  });

  it("handles failure to add +1 gracefully without throwing", async () => {
    const deleteForIssue = vi.fn().mockResolvedValue({});
    const createForIssue = vi.fn().mockRejectedValue(new Error("Forbidden"));
    const octokit = {
      rest: {
        reactions: {
          deleteForIssue,
          createForIssue,
        },
      },
    } as any;

    const reaction: ReactionRef = {
      reactionId: 303,
      type: "issue",
      targetId: 42,
    };

    await expect(
      completeRequest({
        octokit,
        owner: "test-owner",
        repo: "test-repo",
        reaction,
      })
    ).resolves.not.toThrow();
  });

  it("falls back to target parameters when reaction is undefined", async () => {
    const createForIssueComment = vi.fn().mockResolvedValue({ data: { id: 555 } });
    const octokit = {
      rest: {
        reactions: {
          createForIssueComment,
        },
      },
    } as any;

    await completeRequest({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      commentId: 456,
      prNumber: 42,
    });

    expect(createForIssueComment).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      comment_id: 456,
      content: "+1",
    });
  });
});
