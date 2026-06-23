import * as github from "@actions/github";

const ALLOWED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const COMMAND = "/gemini-review";

export interface TriggerDecision {
  run: boolean;
  prNumber?: number;
  reason?: string;
  /** Comment to acknowledge with a reaction (set for /gemini-review commands). */
  commentId?: number;
}

/**
 * Decide whether to run, based on the event. Handles:
 *  - pull_request (opened/synchronize/reopened): auto-review, same-repo only.
 *  - issue_comment (created) containing /gemini-review: write-access authors only.
 */
export function decideTrigger(): TriggerDecision {
  const { eventName, payload } = github.context;

  if (eventName === "pull_request") {
    const pr = payload.pull_request;
    if (!pr) return { run: false, reason: "no pull_request in payload" };
    if (pr.head?.repo?.fork) return { run: false, reason: "fork PR (unsupported in v1)" };
    return { run: true, prNumber: pr.number };
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
    return { run: true, prNumber: issue.number, commentId: comment.id };
  }

  return { run: false, reason: `unsupported event ${eventName}` };
}
