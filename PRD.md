# gemini-review-bot — PRD & Technical Spec

**Status:** Draft v0.3
**Owner:** jk@codebrew.au
**Last updated:** 2026-06-21

> **History:** v0.1–0.2 wrapped the Antigravity CLI (`agy`). Dropped because `agy` only
> supports interactive OAuth, not headless API-key auth
> ([antigravity-cli#78](https://github.com/google-antigravity/antigravity-cli/issues/78)),
> which is unusable on an ephemeral CI runner. v0.3 calls the **Gemini API directly** with
> the adopter's AI Studio key — more reliable in CI and natively structured.

## 1. Summary

A free, open-source **GitHub Action** that performs automated AI code review on pull
requests, replacing the sunsetting Gemini Code Assist GitHub App. It calls the **Gemini API**
with the adopter's AI Studio key to review diffs, post inline comments with suggestions, and
tag findings by priority. Adopters install it by dropping in a workflow file and setting one
secret. There is **no hosted service** and **no cost to the maintainer**; adopters pay only
their own model quota (free tier available).

## 2. Goals

- Drop-in replacement for the core Gemini Code Assist review loop.
- Zero infrastructure: runs entirely on the adopter's GitHub-hosted runner.
- Inline review comments anchored to specific diff lines, with GitHub `suggestion` blocks
  where a clean single-hunk fix exists.
- Findings labelled **Critical / High / Medium / Low**.
- Triggered automatically on PR open/update **and** on demand via `/gemini-review` comment.
- Adopter chooses the model via config; sensible default that fits free-tier quota.

## 3. Non-goals (deferred to v2+)

- Follow-up Q&A / conversational threads on review comments.
- Fork-PR support (security + token-permission complexity).
- Failing/gating the PR check run on findings.
- Hosted GitHub App, dashboards, or any maintainer-run backend.
- Agentic whole-repo exploration (reviews the diff + PR title/body only).

## 4. Users & adoption flow

**Adopter (single repo):**
1. Create an AI Studio API key (Gemini free tier).
2. Add it as repo secret `GEMINI_API_KEY`.
3. Add `.github/workflows/gemini-review.yml` referencing this action.
4. (Optional) Add `.github/gemini-review.yml` to tune ignores, model, limits.

**Adopter (org-wide):** Set `GEMINI_API_KEY` as an organization secret (scoped to selected
repos); add a reusable workflow once in the org `.github` repo + a tiny caller per repo.

**PR author / reviewer:** Open a PR → auto-review runs. Comment `/gemini-review` to re-run.

## 5. Architecture

Reusable **composite GitHub Action** running on **Node 24** (native TypeScript — no build
step, no committed bundle; deps installed via `npm ci` at run time). No server.

```
PR event / issue_comment
        │
        ▼
GitHub Actions runner (adopter-hosted, free)
        │  fetch PR files/patches via Octokit, filter ignores + caps
        ▼
  Gemini API  ── generateContent + responseSchema ──►  GEMINI_API_KEY (adopter's)
        │  validated JSON (summary + findings)
        ▼
  GitHub REST Reviews API  ──auth──►  GITHUB_TOKEN (github-actions[bot])
        │
        ▼
  inline comments (stacked) + rolling summary comment
```

### 5.1 Triggers

| Trigger | Event | Behaviour |
|---|---|---|
| Auto-review | `pull_request` (`opened` only) | One review when the PR is opened |
| On-demand | `issue_comment` (`created`) body starts with `/gemini-review` | Re-review |

Deliberately **not** triggered on `synchronize` — re-reviewing every push burns quota and
is noisy. Re-reviews after new commits are explicit, via the `/gemini-review` comment.

- `issue_comment` workflows run from the **default branch** copy of the workflow and
  receive a write-scoped `GITHUB_TOKEN`. Gate command execution on
  `author_association ∈ {OWNER, MEMBER, COLLABORATOR}`; ignore all others.
- **Same-repo PRs only.** If `pull_request.head.repo.fork == true`, skip with a one-line
  notice. (Fork token is read-only and diffs are untrusted — deferred.)

### 5.2 Calling the model

- Gemini API via `@google/genai`: `ai.models.generateContent({ model, contents, config })`.
- `config.responseMimeType = "application/json"` + `config.responseSchema` constrains output
  to the findings shape (§5.3) — no fragile text parsing.
- Auth via `GEMINI_API_KEY` (AI Studio). Model from config (`gemini-flash-latest` default).
- Retry with backoff on 429/503/500 (quota/transient). Validate JSON defensively and salvage
  individual findings; a fully empty/invalid response fails the step with an annotation.

### 5.3 Model output contract (responseSchema)

```jsonc
{
  "summary": "string — overall PR assessment, 1-3 sentences",
  "findings": [
    {
      "file": "path/relative/to/repo",
      "line": 123,                 // line in the new file (RIGHT side of diff)
      "end_line": 125,             // optional, for multi-line
      "priority": "critical|high|medium|low",
      "title": "short headline",
      "body": "markdown explanation",
      "suggestion": "optional replacement code for a GitHub suggestion block"
    }
  ]
}
```

Findings are zod-validated; malformed ones are dropped + logged. Only findings whose `line`
falls within the PR diff are posted inline; out-of-diff findings roll into the summary.

### 5.4 Posting logic

- One **review** created via `POST /repos/{o}/{r}/pulls/{n}/reviews` (event `COMMENT`)
  batching all inline comments. If the API rejects the batch (bad line anchor), fall back to
  folding those findings into the summary.
- Each inline comment body: `🔴 Critical — **{title}**\n\n{body}` (+ ` ```suggestion ` block
  when `suggestion` present). Hidden marker `<!-- gemini-review -->` on every comment.
- **Inline comments stack** on each run (per decision).
- **Summary comment is rolling:** find the existing one (by `<!-- gemini-review:summary -->`
  marker) and update it in place; otherwise create. Includes per-priority counts.

### 5.5 Priority levels

| Priority | Badge |
|---|---|
| Critical | 🔴 Critical |
| High | 🟠 High |
| Medium | 🟡 Medium |
| Low | 🟢 Low |

No effect on check-run status (decision: never fail the run).

## 6. Configuration

`.github/gemini-review.yml` (all optional):

```yaml
model: gemini-flash-latest        # default
max_files: 50                     # skip review above this; note in summary
max_diff_bytes: 400000            # skip guard for quota safety
ignore:                           # extra globs (merged with built-in defaults)
  - "docs/**"
instructions: |                   # optional extra review guidance / style guide
  Prefer composition over inheritance. Flag missing tests on new modules.
```

- **Default model:** `gemini-flash-latest` (cheapest/fastest; fits free-tier quota).
- Built-in default ignores always apply: lockfiles, `dist/`, `build/`, `*.min.js`,
  `vendor/`, `*.snap`, `go.sum`.

## 7. Secrets & auth

| Secret | Source | Use |
|---|---|---|
| `GEMINI_API_KEY` | Adopter (AI Studio); repo or org secret | Gemini API auth |
| `GITHUB_TOKEN` | Auto-provided by Actions | Posting comments as `github-actions[bot]` |

Required workflow permissions: `pull-requests: write`, `contents: read`.

Org-wide: one organization secret scoped to selected repos. Caveats — shared quota bucket,
private-repo scoping needs Team/Enterprise, prefer "selected repos" over "all".

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| Gemini 429 / 503 / 500 | Retry with backoff; if still failing, fail step + note in summary |
| Empty / invalid JSON response | Fail step with annotation; post no partial review |
| Diff over `max_files`/`max_diff_bytes` | Skip inline review; summary explains the cap |
| Malformed individual finding | Drop it, log, continue |
| Fork PR | Skip with notice |

## 9. Security considerations

- **Same-repo only** in MVP — avoids exposing the write token / org secret to fork runs.
- **Prompt injection:** PR diffs are untrusted. The prompt frames the diff as DATA, not
  instructions; model output only *proposes* comments — the harness posts them.
- **Command gating:** `/gemini-review` honoured only from write-access authors.
- **Key exposure:** `GEMINI_API_KEY` is an Actions secret, never logged; same-repo scope
  prevents PR authors from exfiltrating it via workflow changes.
- **Free-tier data note:** AI Studio free-tier inputs may be used by Google for training —
  adopters reviewing sensitive code should use a paid key.

## 10. MVP scope

In: reusable composite Action (Node 24, native TS); auto + `/gemini-review` triggers (same-repo); Gemini API call
with responseSchema; inline comments w/ priority + suggestions (stacked); rolling summary;
config file w/ ignores + model + limits; `gemini-flash-latest` default; failure handling;
single-repo + org reusable-workflow setups.

Out (v2 backlog): thread Q&A, fork support, check-gating, comment dedup/resolve, custom
per-path rules, whole-repo context.

## 11. Open risks / to confirm

- **Quota:** even AI Studio free tier is rate-limited; a busy repo (or shared org key) will
  throttle. Mitigated by Flash default + diff caps, but adopters should expect limits.
- **Model id:** confirm `gemini-flash-latest` resolves with an AI Studio key (spike).
- **SDK surface:** verify `@google/genai` `generateContent({config:{responseSchema}})`
  against the installed version.
- **Reviews API line anchoring:** GitHub rejects a whole review if any comment `line` isn't
  in the diff — validate against a real PR (summary-fallback implemented).
- **EOL timing:** confirm actual Gemini CLI / Code Assist cutoff to gauge urgency.

## 12. Milestones (suggested)

1. **Spike (0.5 d):** Gemini API smoke test in Actions — key + model id + quota.
2. **Core review (done in scaffold):** diff → prompt → Gemini → inline + summary on auto trigger.
3. **Command + config (done in scaffold):** `/gemini-review`, gating, config, ignores.
4. **Hardening (1–2 d):** failure paths, caps messaging, injection framing, more tests, docs.
5. **Release:** public repo, README, Marketplace listing; pin a `v1` tag.
