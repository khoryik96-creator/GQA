# AI code review (v0.20)

GQA can review a project's **public** GitHub repository with a configured
language model and produce an evidence-checked QA report: findings with
severity, file and line, the quoted code, a recommended fix and a test that
would confirm the problem, plus areas that lack test coverage.

This is the first step of the larger pipeline
**repository → AI analysis → findings → test validation → report**. Test
validation is not implemented yet, so every finding is stored as
`suspected` until a later step reproduces it.

## Choosing a model provider

| `GQA_LLM_PROVIDER` | Default endpoint | Default model | Notes |
| --- | --- | --- | --- |
| `deepseek` (default) | `https://api.deepseek.com/chat/completions` | `deepseek-v4-flash` | Lowest cost. Use `deepseek-v4-pro` for deeper reviews. |
| `openai` (alias `gpt`) | `https://api.openai.com/v1/chat/completions` | `gpt-5.6-terra` | Chat Completions API. |
| `gemini` (alias `google`) | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | none, set `GQA_LLM_MODEL` | Gemini OpenAI-compatible endpoint. |
| `anthropic` (alias `claude`) | `https://api.anthropic.com` | `claude-opus-5-5` | Official Anthropic Go SDK (Messages API, streaming). `claude-sonnet-5-5` or `claude-haiku-5-5` cost less. |
| `custom` | `GQA_LLM_CHAT_COMPLETIONS_URL` (required) | `GQA_LLM_MODEL` (required) | Any HTTPS OpenAI-compatible endpoint. Older configurations that set only the URL are treated as `custom`. |

Model IDs change often. Override the default with `GQA_LLM_MODEL`
whenever a provider renames or retires a model.

```env
# .env — switch providers by changing two lines
GQA_LLM_PROVIDER=deepseek
GQA_LLM_API_KEY=<your provider API key>
GQA_LLM_MODEL=                     # optional override
GQA_LLM_SEND_PROJECT_CONTEXT=true  # explicit consent to send source code
```

`GQA_LLM_SEND_PROJECT_CONTEXT` stays `false` by default. **Starting a review
sends repository source code to the selected third party.** Only enable it
for code you are authorized to share with that provider.

The same provider is also used by the existing AI test planner and
browser-flow drafter.

For Claude, GQA enables Anthropic's server-side refusal fallback
(`fallbacks: "default"`) so that a request declined by a safety classifier
is answered by a fallback model within the same call. It requests `high`
effort for code review and `medium` for planning.

## How a review runs

1. A user with the **owner** or **QA** role starts a review from the
   **Code Review** tab, with an optional focus such as "authentication" or
   "payments". Each account may start 10 reviews per project per hour, and
   the database allows only one running review per project.
2. GQA resolves the default branch to an exact commit SHA and reads the
   file tree. It selects up to 80 source files (60 KB each, 360 KB total),
   skipping dependencies, build output, generated, minified and test files,
   and prioritizing security- and data-sensitive paths and the requested
   focus.
3. Files are sent with line numbers in batches of about 120 KB. The system
   prompt tells the model that repository content is untrusted data and must
   not be followed as instructions.
4. **Evidence check:** every finding must name a reviewed file, a valid line
   range and a code excerpt that appears verbatim (ignoring whitespace)
   within three lines of the cited range. Findings that fail are discarded
   and counted, so that invented files, lines or code never reach the report.
5. Findings are deduplicated, sorted by severity, numbered `CR-001`, and
   stored with the provider label and commit SHA. Source file contents are
   never stored.

Reviews run in the background; the dashboard polls until they finish.
A review that is still running when the API restarts, or after 20 minutes,
is marked `failed`.

## API

| Method | Path | Role |
| --- | --- | --- |
| `POST` | `/api/projects/{id}/code-reviews` with `{"focus": "..."}` | owner, QA |
| `GET` | `/api/projects/{id}/code-reviews` (latest 20) | any project member |
| `GET` | `/api/projects/{id}/code-reviews/{reviewId}` | any project member |

Without a configured provider, `POST` returns `503` with setup guidance.
GQA never substitutes a rules-based review for a model review.

## Limits

- Public GitHub repositories only. Unauthenticated GitHub API calls are
  limited to 60 per hour per IP address. Each review uses three API calls;
  file contents are fetched from `raw.githubusercontent.com`.
- Large repositories are reviewed partially. The report states how many
  reviewable files were left out.
- A model can still miss defects, or report one that passes the evidence
  check but is wrong. No findings is **not** evidence of correct code.
- Review creation is not yet in the append-only QA activity audit.
- Next steps: generate a reproducing test for each finding, run it in the
  isolated runner, and mark the finding `confirmed` or `not reproduced`.
