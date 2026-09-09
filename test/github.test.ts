import { describe, it, expect, vi } from "vitest";
import { postReview } from "../src/github.ts";
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
