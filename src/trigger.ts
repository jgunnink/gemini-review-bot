import * as github from "@actions/github";

const ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const COMMAND = "/gemini-review";

export type TriggerType = "review" | "thread_reply";

export interface TriggerDecision {
  run: boolean;
  type?: TriggerType;
  prNumber?: number;
  reason?: string;
  /** Comment to acknowledge with a reaction (set for /gemini-review issue commands). */
  commentId?: number;
  /** Review comment to acknowledge and reply to (set for pull_request_review_comment). */
  reviewCommentId?: number;
  /** If present, ID of the root comment in the review thread. */
  inReplyToId?: number;
  /** Cleaned question/inquiry text for thread reply. */
  question?: string;
}

const REVIEW_COMMENT_CMD_REGEX = /(?:^|\s)(?:\/gemini(?:-review)?|@gemini)\b/i;

/**
 * Extract question from review comment body by stripping the leading command.
 */
export function extractReviewCommentQuestion(body: string): string {
  const trimmed = body.trim();
  const cleaned = trimmed.replace(/^(?:\/gemini(?:-review)?|@gemini)\b[:,\s]*/i, "").trim();
  return cleaned || "Please review this code and provide feedback or suggestions.";
}

/**
 * Decide whether to run, based on the event. Handles:
 *  - pull_request (opened/synchronize/reopened): auto-review, same-repo only.
 *  - issue_comment (created) containing /gemini-review: write-access authors only.
 *  - pull_request_review_comment (created) containing /gemini or /gemini-review: write-access authors only.
 */
export function decideTrigger(): TriggerDecision {
  const { eventName, payload } = github.context;

  if (eventName === "pull_request") {
    const pr = payload.pull_request;
    if (!pr) return { run: false, reason: "no pull_request in payload" };
    if (pr.head?.repo?.fork) return { run: false, reason: "fork PR (unsupported in v1)" };
    return { run: true, type: "review", prNumber: pr.number };
  }

  if (eventName === "issue_comment") {
    const comment = payload.comment;
    const issue = payload.issue;
    if (!comment || !issue?.pull_request) {
      return { run: false, reason: "not a PR comment" };
    }
    if (!String(comment.body ?? "").trim().startsWith(COMMAND)) {
      return { run: false, reason: "no /gemini-review command" };
    }
    if (!ALLOWED_ASSOCIATIONS.has(comment.author_association)) {
      return { run: false, reason: `author_association ${comment.author_association} not allowed` };
    }
    return { run: true, type: "review", prNumber: issue.number, commentId: comment.id };
  }

  if (eventName === "pull_request_review_comment") {
    if (payload.action && payload.action !== "created") {
      return { run: false, reason: `review comment action ${payload.action} not supported` };
    }
    const pr = payload.pull_request;
    const comment = payload.comment;
    if (!pr || !comment) {
      return { run: false, reason: "missing pull_request or comment in payload" };
    }
    if (pr.head?.repo?.fork) {
      return { run: false, reason: "fork PR (unsupported in v1)" };
    }
    if (comment.user?.type === "Bot" || comment.user?.login === "github-actions[bot]") {
      return { run: false, reason: "ignoring bot review comment to prevent loops" };
    }
    if (!ALLOWED_ASSOCIATIONS.has(comment.author_association)) {
      return { run: false, reason: `author_association ${comment.author_association} not allowed` };
    }
    const body = String(comment.body ?? "");
    if (!REVIEW_COMMENT_CMD_REGEX.test(body)) {
      return { run: false, reason: "no /gemini or /gemini-review command in review comment" };
    }
    return {
      run: true,
      type: "thread_reply",
      prNumber: pr.number,
      reviewCommentId: comment.id,
      inReplyToId: comment.in_reply_to_id,
      question: extractReviewCommentQuestion(body),
    };
  }

  return { run: false, reason: `unsupported event ${eventName}` };
}
