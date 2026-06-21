# gemini-review-bot

AI code review for GitHub pull requests, powered by the **Gemini API**.
A free, open-source GitHub Action — a drop-in replacement for the sunsetting Gemini Code
Assist review bot. No hosted service: it runs on your own runner with your own API key.

- 🔎 Reviews PR diffs and posts **inline comments** with code **suggestions**.
- 🏷️ Labels findings **🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low**.
- ⚡ Reviews automatically when a PR is **opened**; re-review on demand with `/gemini-review`.
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

## Configuration (`.github/gemini-review.yml`, optional)

```yaml
model: gemini-flash-latest      # default; Gemini model id
max_files: 50                   # skip review above this many changed files
max_diff_bytes: 400000          # skip review above this diff size
ignore:                         # extra globs (merged with built-in defaults)
  - "docs/**"
instructions: |                 # optional extra review guidance
  Flag any new module that ships without tests.
```

Built-in ignores (always applied): lockfiles, `dist/`, `build/`, `*.min.js`, `vendor/`,
`*.snap`, `go.sum`.

## How it works

`pull_request` / `issue_comment` → diff fetched via Octokit → filtered by ignores + size
caps → prompt built (diff framed as untrusted data) → **Gemini API call with a
`responseSchema`** (native JSON, no fragile parsing) → findings validated → inline comments
+ rolling summary posted as `github-actions[bot]`.

See [PRD.md](PRD.md) and [BUILD_PLAN.md](BUILD_PLAN.md) for the full spec.

## Limitations (v1)

- **Same-repo PRs only** (fork PRs unsupported — security/token reasons).
- No follow-up Q&A threads yet.
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
