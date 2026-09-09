import * as core from "@actions/core";
import * as github from "@actions/github";
import { decideTrigger } from "./trigger.ts";
import { loadConfig } from "./config.ts";
import { filterDiff } from "./diff.ts";
import { buildPrompt, buildThreadPrompt } from "./prompt.ts";
import { runReview, runThreadReply } from "./gemini.ts";
import { acknowledgeRequest, postReview, fetchThreadContext, postThreadReply } from "./github.ts";
import { resolveAuth } from "./auth.ts";

async function run(): Promise<void> {
  const decision = decideTrigger();
  if (!decision.run || !decision.prNumber) {
    core.info(`Skipping: ${decision.reason ?? "no PR"}`);
    return;
  }

  const token = core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
  if (!token) throw new Error("github_token is required.");

  const geminiApiKey = core.getInput("gemini_api_key") || process.env.GEMINI_API_KEY || "";
  const agentPlatformApiKey =
    core.getInput("agent_platform_api_key") ||
    process.env.AGENT_PLATFORM_API_KEY ||
    process.env.AGENT_PLATFORM_KEY ||
    "";
  const auth = resolveAuth(geminiApiKey, agentPlatformApiKey);
  if (auth.useVertex) {
    core.info("Using Vertex AI endpoints via AGENT_PLATFORM_API_KEY.");
  } else {
    core.info("Using Gemini API endpoints via GEMINI_API_KEY.");
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const prNumber = decision.prNumber;

  // Acknowledge immediately with 👀 so the requester knows we're on it.
  await acknowledgeRequest({
    octokit,
    owner,
    repo,
    prNumber,
    commentId: decision.commentId,
    reviewCommentId: decision.reviewCommentId,
  });

  const config = loadConfig(
    core.getInput("config_path") || ".github/gemini-review.yml",
    core.getInput("model"),
    core.getInput("instructions")
  );

  const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });

  if (decision.type === "thread_reply" && decision.reviewCommentId) {
    core.info(`Processing inline review comment Q&A (comment id ${decision.reviewCommentId})...`);
    const threadCtx = await fetchThreadContext({
      octokit,
      owner,
      repo,
      prNumber,
      reviewCommentId: decision.reviewCommentId,
      inReplyToId: decision.inReplyToId,
      question: decision.question ?? "Please review this code and provide feedback or suggestions.",
    });

    const threadPrompt = buildThreadPrompt({
      filePath: threadCtx.filePath,
      diffHunk: threadCtx.diffHunk,
      thread: threadCtx.thread,
      userQuestion: threadCtx.userQuestion,
      config,
      prTitle: pr.data.title ?? "",
      prBody: pr.data.body ?? "",
    });

    core.info(`Calling Gemini with model ${config.model} for thread reply...`);
    const { reply, usage } = await runThreadReply(
      threadPrompt,
      config.model,
      auth.apiKey,
      auth.useVertex
    );

    await postThreadReply({
      octokit,
      owner,
      repo,
      prNumber,
      commentId: threadCtx.replyTargetCommentId,
      reply,
      usage,
    });
    core.info("Thread reply posted successfully.");
    return;
  }
  const prFiles = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  const { files, note } = filterDiff(prFiles, config);

  if (files.length === 0) {
    core.info(`Nothing to review. ${note ?? ""}`);
    // Still surface the cap/skip reason in the summary so users aren't confused.
    await postReview({
      octokit, owner, repo, prNumber,
      commitId: pr.data.head.sha,
      summary: note ?? "No reviewable changes.",
      findings: [], files: [], extraNote: note,
    });
    return;
  }

  const prompt = buildPrompt(files, config, pr.data.title ?? "", pr.data.body ?? "");
  core.info(`Reviewing ${files.length} file(s) with model ${config.model}...`);

  const review = await runReview(prompt, config.model, auth.apiKey, auth.useVertex);
  core.info(`Parsed ${review.findings.length} finding(s).`);

  await postReview({
    octokit, owner, repo, prNumber,
    commitId: pr.data.head.sha,
    summary: review.summary,
    findings: review.findings,
    files,
    extraNote: note,
    usage: review.usage,
  });
}

run().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
