import * as github from "@actions/github";
import * as core from "@actions/core";
import { PRIORITY_BADGE, type Finding, type DiffFile, type TokenUsage } from "./types.ts";
import { extractDiffLineNumbers } from "./diff.ts";

type Octokit = ReturnType<typeof github.getOctokit>;

const SUMMARY_MARKER = "<!-- gemini-review:summary -->";
const COMMENT_MARKER = "<!-- gemini-review -->";

interface PostArgs {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  commitId: string;
  summary: string;
  findings: Finding[];
  files: DiffFile[];
  extraNote?: string;
  usage?: TokenUsage;
}

/**
 * Acknowledge a review request with a 👀 reaction, so the requester sees the
 * action picked up the work before the (slower) review lands. Reacts to the
 * triggering comment when present, otherwise to the PR description itself.
 * Best-effort: a failed reaction must not block the review.
 */
export async function acknowledgeRequest(args: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
  commentId?: number;
}): Promise<void> {
  const { octokit, owner, repo, prNumber, commentId } = args;
  try {
    if (commentId !== undefined) {
      await octokit.rest.reactions.createForIssueComment({
        owner,
        repo,
        comment_id: commentId,
        content: "eyes",
      });
    } else {
      await octokit.rest.reactions.createForIssue({
        owner,
        repo,
        issue_number: prNumber,
        content: "eyes",
      });
    }
  } catch (e) {
    core.warning(`Could not add 👀 reaction: ${e instanceof Error ? e.message : String(e)}`);
  }
}

interface ReviewCommentPayload {
  path: string;
  line: number;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
  body: string;
}

/**
 * Post inline comments (stacked, per decision) in a single review, and create or
 * update the rolling summary comment.
 */
export async function postReview(args: PostArgs): Promise<void> {
  const { octokit, owner, repo, prNumber, commitId, findings, files } = args;
  const diffLinesByPath = new Map<string, Set<number>>();
  for (const f of files) {
    diffLinesByPath.set(f.path, extractDiffLineNumbers(f.patch));
  }

  const inlineComments: Array<{
    finding: Finding;
    payload: ReviewCommentPayload;
  }> = [];
  const outOfDiff: Finding[] = [];

  for (const f of findings) {
    const validLines = diffLinesByPath.get(f.file);
    if (!validLines) {
      outOfDiff.push(f);
      continue;
    }

    const startLine = f.line;
    let endLine = f.end_line;

    if (!validLines.has(startLine)) {
      core.info(
        `Finding for ${f.file}:${startLine} ("${f.title}") is outside diff hunks; folding into summary.`
      );
      outOfDiff.push(f);
      continue;
    }

    if (endLine !== undefined && (!validLines.has(endLine) || endLine <= startLine)) {
      endLine = undefined;
    }

    const body = renderComment(f);
    if (endLine !== undefined && endLine > startLine) {
      inlineComments.push({
        finding: f,
        payload: {
          path: f.file,
          line: endLine,
          side: "RIGHT",
          start_line: startLine,
          start_side: "RIGHT",
          body,
        },
      });
    } else {
      inlineComments.push({
        finding: f,
        payload: {
          path: f.file,
          line: startLine,
          side: "RIGHT",
          body,
        },
      });
    }
  }

  let postedCount = 0;

  if (inlineComments.length > 0) {
    try {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitId,
        event: "COMMENT",
        comments: inlineComments.map((c) => c.payload),
      });
      postedCount = inlineComments.length;
    } catch (e) {
      core.warning(
        `Batch inline review failed (${(e as Error).message}); retrying comments individually.`
      );
      for (const item of inlineComments) {
        try {
          await octokit.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number: prNumber,
            commit_id: commitId,
            ...item.payload,
          });
          postedCount++;
        } catch (indivErr) {
          core.warning(
            `Could not post inline comment on ${item.payload.path}:${item.payload.line} (${(indivErr as Error).message}); folding into summary.`
          );
          outOfDiff.push(item.finding);
        }
      }
    }
  }

  await upsertSummary({ ...args, outOfDiff, postedInline: postedCount });
}

function renderComment(f: Finding): string {
  const badge = PRIORITY_BADGE[f.priority];
  let body = `${COMMENT_MARKER}\n${badge} — **${f.title}**\n\n${f.body}`;
  if (f.suggestion) body += `\n\n\`\`\`suggestion\n${f.suggestion}\n\`\`\``;
  return body;
}

async function upsertSummary(
  args: PostArgs & { outOfDiff: Finding[]; postedInline: number }
): Promise<void> {
  const { octokit, owner, repo, prNumber, summary, findings, outOfDiff, extraNote, usage } = args;

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.priority]++;

  let body = `${SUMMARY_MARKER}\n## 🤖 Gemini code review\n\n${summary || "_No summary provided._"}\n\n`;
  body += `**Findings:** 🔴 ${counts.critical} · 🟠 ${counts.high} · 🟡 ${counts.medium} · 🟢 ${counts.low}\n`;
  if (extraNote) body += `\n> ${extraNote}\n`;
  if (outOfDiff.length > 0) {
    body += `\n<details><summary>${outOfDiff.length} finding(s) outside the diff</summary>\n\n`;
    for (const f of outOfDiff) {
      body += `- ${PRIORITY_BADGE[f.priority]} \`${f.file}:${f.line}\` — **${f.title}**: ${f.body}\n`;
    }
    body += `\n</details>\n`;
  }
  if (usage) {
    const fmt = (n: number) => n.toLocaleString("en-US");
    body += `\n---\n`;
    body += `<sub>**Tokens spent** · ⬆️ Input: ${fmt(usage.input)} · ⬇️ Output: ${fmt(usage.output)} · Σ Total: ${fmt(usage.total)}`;
    body += `<br>_Total may be higher due to thinking token counts._</sub>\n`;
  }

  // Rolling summary: find an existing summary comment and update it in place.
  const existing = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const prior = existing.data.find((c) => c.body?.includes(SUMMARY_MARKER));

  if (prior) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: prior.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body });
  }
}
