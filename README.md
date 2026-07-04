# Sandcastle User-Story Pipeline

A 13-step, self-improving AI agent pipeline that drives a single user story all the way
from refinement to a reviewed, committed implementation with an opened pull request —
built on [`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle) with the
**GitHub Copilot CLI** agent and the **Podman** sandbox provider.

Each agent step has its own editable instruction file under `agents/*.Agents.md`. Test
passing is verified **deterministically by the pipeline** (never by the agent). The
acceptance-criteria and code-review loops are capped at 5 iterations; beyond that the
pipeline stops and asks for a human. After every run, a meta-agent improves the other
agents (and then itself) by editing those `.Agents.md` files.

---

## The 13 steps

| # | Step | Runs in | Owner | Output |
| --- | ------ | --------- | ------- | -------- |
| 1 | **Get information** | host | pipeline | clones the repo, checks out the base branch, seeds `.sandcastle-workflow/STORY.md` from title/description/repo |
| 2 | **Refinement** | target sandbox | `02-refinement.Agents.md` | `02-acceptance-criteria.md` (refined story + `AC-n` criteria) |
| 3 | **Technical details** | target sandbox | `03-technical-details.Agents.md` | `03-technical-details.md` (architecture, files, contracts) |
| 4 | **Plan** | target sandbox | `04-plan.Agents.md` | `04-plan.md` (ordered implementation plan) |
| 5 | **Write tests** | target sandbox | `05-write-tests.Agents.md` | unit tests + `05-test-command.txt` (the deterministic test command) |
| 6 | **Implement** | target sandbox | `06-implement.Agents.md` | production code; **the pipeline** then runs the test command and loops until it exits `0` |
| 7 | **Check acceptance criteria** | target sandbox | `07-acceptance-criteria.Agents.md` | `07-acceptance-result.json` `{passed, issues}`; if not passed → back to step 6 (≤ 5×, then human) |
| 8 | **Code review** | target sandbox | `08-code-review.Agents.md` | `08-code-review-result.json` `{approved, mustFix, minor}`; verifies the previous review; if changes needed → back to step 6 (≤ 5×, then human) |
| 9 | **Commit** | target sandbox | `09-commit.Agents.md` | agent writes the message; **the pipeline** performs the deterministic `git commit` |
| 10 | **Improve** | orchestrator | `10-improve.Agents.md` | edits the step 2–9/12/13 role files; may add hooks/MCPs/skills |
| 11 | **Improve self** | orchestrator | `11-improve-self.Agents.md` | improves the improver's own role files |
| 12 | **Summarize** | target sandbox | `12-summarize.Agents.md` | `12-summary.{md,json}` — a Product-Owner part and a technical part |
| 13 | **Create pull request** | target sandbox | `13-create-pr.Agents.md` | `13-pr-title.txt` + `13-pr-description.md` (built from the step-12 summary); **the pipeline** then `git push`es the branch and opens the PR via the GitHub API |

The whole of steps 2–9, 12 and 13 run inside **one warm Podman sandbox** on a dedicated
branch (`sandcastle/<slug>`), so commits and state accumulate together. Steps 10–11
run against **this** repo (the orchestrator) and edit the `agents/*.Agents.md` files in
place, so improvements take effect on the next run.

### Why the test gate is deterministic

The test-author (step 5) writes the exact command to run into `05-test-command.txt`.
The implementer (step 6) only writes code; it is **the pipeline** — not the agent — that
runs `sandbox.exec(<test command>)` and decides pass/fail by the process exit code. The
implement loop repeats until the command exits `0` (or a safety cap triggers a human
escalation).

---

## Prerequisites

- **Node.js** 20+ and **npm**
- **[Podman](https://podman.io/)** with a running machine
  (`podman machine init` once, then `podman machine start`)
- **Git**
- **GitHub Copilot credentials** — a GitHub token with the "Copilot Requests"
  permission (a fine-grained PAT, or any token from `gh auth login`).

## Setup

```powershell
npm install

# Credentials (a GitHub token with the "Copilot Requests" permission):
Copy-Item .sandcastle\.env.example .sandcastle\.env
#   then edit .sandcastle\.env and paste your COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN)

# Build the sandbox image (also auto-built on first run if missing):
npm run build-image
```

This repo (the orchestrator) is itself linted by `npm run lint:md` /
`npm run lint:md:fix` (`markdownlint-cli2`, config in `.markdownlint-cli2.jsonc`).
Every **target repo** the pipeline works on additionally gets a Copilot CLI
`postToolUse` hook that runs the same auto-fix live during agent steps — see
[Optional capabilities the Improver can add](#optional-capabilities-the-improver-can-add)
below.

## Run

```powershell
npm run pipeline -- --title "Add a /health endpoint" `
                    --description "Expose GET /health returning 200 and build info." `
                    --repo owner/repository `
                    --base-branch main
```

`--repo` accepts a full URL, the `owner/repo` shorthand, or a local path.
`--base-branch` is the branch the work is built on (defaults to `main`). Any missing
input is prompted for interactively. The result is a commit on branch
`sandcastle/<slug>` (created from the base branch) inside `.work/<repo>/`, a pull
request opened against the base branch (when a suitably-scoped GitHub token is
configured — see below), plus a printed two-audience summary.

### Useful environment variables

| Variable | Default | Purpose |
| ---------- | --------- | --------- |
| `SANDCASTLE_MODEL` | `claude-sonnet-4.5` | Default model for every step |
| `SANDCASTLE_MODEL_<STEP>` | — | Per-step override (e.g. `SANDCASTLE_MODEL_IMPLEMENT=gpt-5`; steps: `REFINE`,`TECHNICAL`,`PLAN`,`TESTS`,`IMPLEMENT`,`ACCEPTANCE`,`REVIEW`,`COMMIT`,`IMPROVE`,`IMPROVE-SELF`,`SUMMARIZE`,`CREATE-PR`) |
| `SANDCASTLE_AGENT` | `copilot` | Agent backend (`copilot` or `claude`) |
| `SANDCASTLE_IMAGE` | `sandcastle:userstory-pipeline` | Podman image name |
| `SANDCASTLE_WORK_DIR` | `.work` (inside this repo) | Local path where target repos are cloned |
| `SANDCASTLE_MAX_AC` | `5` | Acceptance-criteria loop cap before human escalation |
| `SANDCASTLE_MAX_REVIEW` | `5` | Code-review loop cap before human escalation |
| `SANDCASTLE_MAX_IMPLEMENT` | `10` | Safety cap on the implement→test loop |
| `SANDCASTLE_IDLE_TIMEOUT` | `1200` | Per-step agent idle timeout (seconds) |
| `SANDCASTLE_GITHUB_PR_TOKEN` | falls back to `GH_TOKEN` / `GITHUB_TOKEN` | Token used by step 13 to `git push` and open the pull request via the GitHub API. Needs `Contents: Read & write` and `Pull requests: Read & write` (fine-grained PAT), or `repo` scope (classic PAT) — broader than the Copilot-only token above. If none is configured, step 13 logs a warning and skips (the reviewed work stays committed on its branch). |

Inputs can also be supplied via `SANDCASTLE_TITLE`, `SANDCASTLE_DESCRIPTION`,
`SANDCASTLE_REPO`, `SANDCASTLE_BASE_BRANCH` (default `main`).

### Using your own models (BYOK)

When `SANDCASTLE_AGENT=copilot` (the default), the GitHub Copilot CLI supports
**BYOK** ("Bring Your Own Key") — routing model requests to your own OpenAI-, Azure-,
or Anthropic-compatible endpoint (e.g. Ollama, LM Studio, LiteLLM, Azure OpenAI)
instead of GitHub-hosted models. See
[Using your own LLM models in GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models).

Set these in `.sandcastle/.env` (the pipeline provisions them into every target-repo
sandbox alongside your GitHub token):

| Variable | Required | Description |
| ---------- | ---------- | ------------- |
| `COPILOT_PROVIDER_BASE_URL` | Yes (for BYOK) | Base URL of your model provider's API endpoint |
| `COPILOT_PROVIDER_TYPE` | No | `openai` (default), `azure`, or `anthropic` |
| `COPILOT_PROVIDER_API_KEY` | No | API key for the provider (omit for unauthenticated local endpoints) |
| `COPILOT_OFFLINE` | No | `true` to prevent Copilot CLI from contacting GitHub's servers |

The pipeline always passes the model explicitly via `--model` (resolved from
`SANDCASTLE_MODEL` / `SANDCASTLE_MODEL_<STEP>`), so set **`SANDCASTLE_MODEL`** to your
BYOK model id — not `COPILOT_MODEL` (unused by this pipeline; setting it would be
redundant and could silently diverge from the per-step model).

Example — a LiteLLM gateway exposing an Anthropic-Messages-compatible endpoint:

```dotenv
COPILOT_PROVIDER_TYPE=anthropic
COPILOT_PROVIDER_BASE_URL=https://litellm.example.com/
COPILOT_PROVIDER_API_KEY=sk-...
```

> [!NOTE]
> `COPILOT_PROVIDER_TYPE=anthropic` is the Copilot CLI's equivalent of setting
> `"apiType": "messages"` in VS Code's `chatLanguageModels.json` — it makes the CLI
> speak the native Anthropic Messages API instead of OpenAI Chat Completions. There
> is no separate `apiType` setting for the CLI; `COPILOT_PROVIDER_TYPE` **is** that
> knob.
>
> **Known gotcha — Claude Sonnet 5 / Opus 4.7+ and `temperature`:** these newer Claude
> models reject any `temperature` other than `1` with a `400 (temperature is
> deprecated for this model)` error. The Copilot CLI always sends a sampling
> `temperature` and has no flag/env var to omit it, so if you route through a gateway
> (LiteLLM, an internal proxy, etc.) rather than calling Anthropic/Bedrock directly,
> enable param-dropping **on the gateway** so it silently strips unsupported sampling
> params instead of forwarding them upstream. For LiteLLM:
>
> ```yaml
> litellm_settings:
>   drop_params: true
> ```
>
> (or set `litellm_params.drop_params: true` on just that model's entry in
> `model_list`). This can't be fixed from `.sandcastle/.env` — it's server-side only.

```powershell
$env:SANDCASTLE_MODEL = "bedrock.anthropic.claude-sonnet-5"
```

A GitHub token is still required for the CLI's own auth handshake even when BYOK is
active.

---

## How the agents are wired

- The **IO contract** (which artifact files exist and the JSON shapes for verdicts) is
  owned by the pipeline code (`src/`). The **role and heuristics** are owned by the
  editable `agents/*.Agents.md` files. The Improve agent edits the latter, never the
  former — so self-improvement can't break the machinery.
- The prompt for each step is composed in `src/agents.ts` as: a fixed pipeline
  preamble, the role file, run-specific context, and the completion-signal
  instruction (in that order).

### Optional capabilities the Improver can add

The improver (step 10) may add reusable capabilities that the pipeline automatically
wires into every future target-repo run:

- `agents/hooks.json` — Sandcastle sandbox hooks (e.g. a `dotnet restore` /
  `npm ci` on `onSandboxReady`) to make later steps more reliable.
- `agents/copilot-hooks.json` — [GitHub Copilot CLI native hooks](https://docs.github.com/copilot/reference/hooks-reference),
  copied into each target repo as `.github/hooks/sandcastle-pipeline.json`. Unlike
  `agents/hooks.json` above (which only fires once, when the sandbox starts), these
  hooks fire *during* an agent step — e.g. `postToolUse`, after every tool call the
  agent makes. Ships by default with a `postToolUse` hook that runs
  `markdownlint-cli2 --fix` on any `.md` file the agent just created or edited, so
  Markdown lint issues are corrected automatically as the agent works rather than
  caught later in review. Only takes effect for the `copilot` agent backend — the
  pipeline sets `GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS=true` (see `src/agents.ts`) so
  the CLI's non-interactive `-p` mode loads this repo-level hook file; the Containerfile
  installs `markdownlint-cli2` globally so it's on `PATH` inside the sandbox. Delete
  the file, or edit its `hooks` object, to change or remove this behavior.
- `agents/mcp.json` — copied into each target repo as `.mcp.json` (MCP servers; the
  GitHub Copilot CLI reads project-level `.mcp.json`). Ships by default with the
  hosted **GitHub MCP server** (`https://api.githubcopilot.com/mcp/`, named `github`
  so it runs alongside Copilot CLI's built-in read-only GitHub MCP server rather than
  replacing it) — set `GITHUB_PERSONAL_ACCESS_TOKEN` in `.sandcastle/.env` to
  authenticate it, or delete the file/entry if you don't want it. Add more servers to
  the `mcpServers` object as needed.
- `agents/skills/**` — copied into each target repo as `.claude/skills/` (used when
  running with the `claude` backend).

---

## Output & escalation

- **Run reports** are written to `runs/<run-id>/report.md` with per-step status, loop
  counts, the deterministic test runs, and any escalation. Raw agent logs land in
  `runs/<run-id>/logs/`. The Improver reads these to decide what to fix.
- **Human escalation**: if the acceptance or review loop exceeds 5 iterations (or the
  implement/test loop exceeds its safety cap), the pipeline stops, prints a clear
  "HUMAN HELP REQUIRED" message with the blocking details, writes the report, and exits
  with code `2`.

---

## Layout

```text
.sandcastle/
  Containerfile        # Podman image (node + python + dotnet + gh + GitHub Copilot CLI)
  .env.example         # credential template (copy to .env)
agents/
  02-refinement.Agents.md … 13-create-pr.Agents.md   # one editable role file per step
  hooks.json           # optional setup hooks (Improver-maintained)
src/
  index.ts             # CLI entry: inputs, prereqs, run, escalation, summary
  pipeline.ts          # the 12-step orchestration
  config.ts schemas.ts inputs.ts agents.ts env.ts git.ts
  capabilities.ts report.ts escalation.ts logger.ts
```

## Customizing the toolchain

The sandbox image installs Node, Python, .NET 8 and the GitHub CLI so it can build and
test a variety of repositories. Trim or extend the toolchain block in
`.sandcastle/Containerfile` to match the stacks you actually target, then
`npm run build-image` again. (A leaner image starts faster.)
