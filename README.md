# gemini-review-bot

AI code review for GitHub pull requests, powered by the **Gemini API**.
A free, open-source GitHub Action — a drop-in replacement for the sunsetting Gemini Code
Assist review bot. No hosted service: it runs on your own runner with your own API key.

- 🔎 Reviews PR diffs and posts **inline comments** with code **suggestions**.
- 🏷️ Labels findings **🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low**.
- 💬 **Follow-up Q&A**: reply to any review comment thread with `/gemini <question>` or `/gemini-review <question>`.
- 🎯 **On-demand line reviews**: start a review comment on any diff line with `/gemini <question>`.
- ⚡ Reviews automatically when a PR is **opened**; re-review the whole PR with `/gemini-review`.
- 👀 Reacts with an **eyes** emoji the moment it picks up a request, so you know it's working.
- 🧩 Configurable model, ignores, and limits.

## Quick start (single repo)

1. Create a [Google AI Studio](https://aistudio.google.com/) API key.
2. Add it as a repository secret named `GEMINI_API_KEY`.
3. (Optional) Run the **spike** workflow ([.github/workflows/spike.yml](.github/workflows/spike.yml))
   to confirm your key + model id work and you're within quota.
4. Add `.github/workflows/gemini-review.yml` (see [examples/gemini-review.yml](examples/gemini-review.yml)).

## Org-wide setup (one key for many repos)

Set `GEMINI_API_KEY` **once** as an organization secret
(Org → Settings → Secrets and variables → Actions), scoped to selected repos, then:

1. Add the reusable workflow to your org's `.github` repo
   ([examples/org-reusable-workflow.yml](examples/org-reusable-workflow.yml)).
2. Add the tiny caller to each repo
   ([examples/org-caller-workflow.yml](examples/org-caller-workflow.yml)).

Notes:
- **Shared quota:** one key = one AI Studio quota bucket shared across all repos. For more
  than a couple of active repos, use a **paid** key or split keys per team.
- **Plan limits:** restricting an org secret to *private* repos needs GitHub Team/Enterprise
  (public repos work on Free).
- **Scope it:** grant the secret to *selected* repos, not "all". Fork PRs never receive org
  secrets — which aligns with this action's same-repo-only rule.

## Configuration

Settings live in **two different files** — don't mix them up:

1. **The workflow** (`.github/workflows/gemini-review.yml`) runs the action and passes
   **action inputs** under `with:`.
2. **The config file** (`.github/gemini-review.yml` — note: *not* in `workflows/`) holds
   review settings. It's optional.

### Action inputs (workflow `with:`)

| Input                    | Required | Description                                                                                    |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------- |
| `gemini_api_key`         | see note | Google AI Studio API key (Gemini API endpoints). Pass a secret.                                |
| `agent_platform_api_key` | see note | Vertex AI / Agent Platform API key (Vertex AI endpoints). Pass a secret.                       |
| `github_token`           | no       | Token for posting comments. Defaults to the automatic `GITHUB_TOKEN`.                           |
| `model`                  | no       | Gemini model id. Overrides the config file.                                                    |
| `instructions`           | no       | Extra review guidance. Overrides the config file.                                              |
| `config_path`            | no       | Path to the config file. Default: `.github/gemini-review.yml`.                                 |

> [!NOTE]
> Either `gemini_api_key` (or `GEMINI_API_KEY` env var) or `agent_platform_api_key` (or `AGENT_PLATFORM_API_KEY` env var) must be provided.
> If `GEMINI_API_KEY` is set, Gemini API endpoints are used. If `AGENT_PLATFORM_API_KEY` is set instead, Vertex AI endpoints are used.

```yaml
# Using Google AI Studio (default Gemini API)
- uses: jgunnink/gemini-review-bot@v1
  with:
    gemini_api_key: ${{ secrets.GEMINI_API_KEY }}

# Or using Vertex AI endpoints
- uses: jgunnink/gemini-review-bot@v1
  with:
    agent_platform_api_key: ${{ secrets.AGENT_PLATFORM_API_KEY }}
```

### Config file (`.github/gemini-review.yml`, optional)

```yaml
model: gemini-flash-latest      # default; Gemini model id
max_diff_bytes: 400000          # skip review above this diff size
max_findings: 10                # maximum number of review findings (default: 10)
ignore:                         # extra globs (merged with built-in defaults)
  - "docs/**"
instructions: |                 # optional extra review guidance
  Flag any new module that ships without tests.
```

`model` and `instructions` can be set in either place; the action input wins when both are
set. `max_diff_bytes`, `max_findings`, and `ignore` are config-file only.

Built-in ignores (always applied): lockfiles, `dist/`, `build/`, `*.min.js`, `vendor/`,
`*.snap`, `go.sum`.

## How it works
 
- **Full PR review:** `pull_request` / `issue_comment` → 👀 reaction added to acknowledge the request (the
  `/gemini-review` comment, or the PR description on auto-review) → diff fetched via Octokit → filtered by ignores + size
  caps → prompt built (diff framed as untrusted data) → **Gemini API call with a
  `responseSchema`** (native JSON, no fragile parsing) → findings validated → inline comments
  + rolling summary posted as `github-actions[bot]`.
- **Inline thread Q&A / Line inquiries:** `pull_request_review_comment` containing `/gemini` or `/gemini-review`
  (or `@gemini`) → 👀 reaction added to the comment → comment thread history and diff hunk fetched →
  Gemini generates a targeted markdown response (with `suggestion` code blocks when appropriate) → posted
  directly as a reply in the review thread.

See [PRD.md](PRD.md) and [BUILD_PLAN.md](BUILD_PLAN.md) for the full spec.

## Limitations (v1)

- **Same-repo PRs only** (fork PRs unsupported — security/token reasons).
- Reviews the **diff** (+ PR title/body), not the whole repo. No agentic file exploration.
- Inline comments **stack** on re-review; the summary comment updates in place.
- Subject to your AI Studio quota (free tier is rate-limited).

## Development

```bash
npm install        # local dev only — do NOT commit the resulting lockfile (see below)
npm run typecheck
npm test
npm start          # runs src/main.ts directly on Node 24 (native TS — no build step)
```

### Updating dependencies

CI and the action run on Linux with strict `npm ci`, so `package-lock.json` must be
generated on Linux — a macOS/Windows lockfile omits Linux-only optional native bindings
(e.g. Vitest's `unrs-resolver`) and breaks `npm ci`. After changing deps, regenerate it in a
Linux container and commit only that lockfile:

```bash
docker run --rm -v "$PWD":/app -w /app node:24-slim \
  bash -c "rm -rf node_modules package-lock.json && npm install"
```

## License

MIT
