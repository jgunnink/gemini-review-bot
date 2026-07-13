import * as core from "@actions/core";
import * as github from "@actions/github";
import { decideTrigger } from "./trigger.ts";
import { loadConfig } from "./config.ts";
import { filterDiff } from "./diff.ts";
import { buildPrompt } from "./prompt.ts";
import { runReview } from "./gemini.ts";
import { acknowledgeRequest, postReview } from "./github.ts";

async function run(): Promise<void> {
  const decision = decideTrigger();
  if (!decision.run || !decision.prNumber) {
    core.info(`Skipping: ${decision.reason ?? "no PR"}`);
    return;
  }

  const token = core.getInput("github_token") || process.env.GITHUB_TOKEN || "";
  const apiKey = core.getInput("gemini_api_key") || process.env.GEMINI_API_KEY || "";
  if (!token) throw new Error("github_token is required.");
  if (!apiKey) throw new Error("gemini_api_key is required.");

  const octokit = github.getOctokit(token);
  const { owner, repo } = github.context.repo;
  const prNumber = decision.prNumber;

  // Acknowledge immediately with 👀 so the requester knows we're on it.
  await acknowledgeRequest({ octokit, owner, repo, prNumber, commentId: decision.commentId });

  const config = loadConfig(
    core.getInput("config_path") || ".github/gemini-review.yml",
    core.getInput("model"),
    core.getInput("instructions")
  );

  const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
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

  const review = await runReview(prompt, config.model, apiKey);
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
