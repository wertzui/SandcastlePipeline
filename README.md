# Sandcastle User-Story Pipeline

A 12-step, self-improving AI agent pipeline that drives a single user story all the way
from refinement to a reviewed, committed implementation — built on
[`@ai-hero/sandcastle`](https://github.com/mattpocock/sandcastle) with the
**GitHub Copilot CLI** agent and the **Podman** sandbox provider.

Each agent step has its own editable instruction file under `agents/*.Agents.md`. Test
passing is verified **deterministically by the pipeline** (never by the agent). The
acceptance-criteria and code-review loops are capped at 5 iterations; beyond that the
pipeline stops and asks for a human. After every run, a meta-agent improves the other
agents (and then itself) by editing those `.Agents.md` files.

---

## The 12 steps

| # | Step | Runs in | Owner | Output |
|---|------|---------|-------|--------|
| 1 | **Get information** | host | pipeline | clones the repo, checks out the base branch, seeds `.sandcastle-workflow/STORY.md` from title/description/repo |
| 2 | **Refinement** | target sandbox | `02-refinement.Agents.md` | `02-acceptance-criteria.md` (refined story + `AC-n` criteria) |
| 3 | **Technical details** | target sandbox | `03-technical-details.Agents.md` | `03-technical-details.md` (architecture, files, contracts) |
| 4 | **Plan** | target sandbox | `04-plan.Agents.md` | `04-plan.md` (ordered implementation plan) |
| 5 | **Write tests** | target sandbox | `05-write-tests.Agents.md` | unit tests + `05-test-command.txt` (the deterministic test command) |
| 6 | **Implement** | target sandbox | `06-implement.Agents.md` | production code; **the pipeline** then runs the test command and loops until it exits `0` |
| 7 | **Check acceptance criteria** | target sandbox | `07-acceptance-criteria.Agents.md` | `07-acceptance-result.json` `{passed, issues}`; if not passed → back to step 6 (≤ 5×, then human) |
| 8 | **Code review** | target sandbox | `08-code-review.Agents.md` | `08-code-review-result.json` `{approved, mustFix, minor}`; verifies the previous review; if changes needed → back to step 6 (≤ 5×, then human) |
| 9 | **Commit** | target sandbox | `09-commit.Agents.md` | agent writes the message; **the pipeline** performs the deterministic `git commit` |
| 10 | **Improve** | orchestrator | `10-improve.Agents.md` | edits the step 2–9/12 role files; may add hooks/MCPs/skills |
| 11 | **Improve self** | orchestrator | `11-improve-self.Agents.md` | improves the improver's own role files |
| 12 | **Summarize** | target sandbox | `12-summarize.Agents.md` | `12-summary.{md,json}` — a Product-Owner part and a technical part |

The whole of steps 2–9 and 12 run inside **one warm Podman sandbox** on a dedicated
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
`sandcastle/<slug>` (created from the base branch) inside `.work/<repo>/`, plus a
printed two-audience summary.

### Useful environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SANDCASTLE_MODEL` | `claude-sonnet-4.5` | Default model for every step |
| `SANDCASTLE_MODEL_<STEP>` | — | Per-step override (e.g. `SANDCASTLE_MODEL_IMPLEMENT=gpt-5`; steps: `REFINE`,`TECHNICAL`,`PLAN`,`TESTS`,`IMPLEMENT`,`ACCEPTANCE`,`REVIEW`,`COMMIT`,`IMPROVE`,`IMPROVE-SELF`,`SUMMARIZE`) |
| `SANDCASTLE_AGENT` | `copilot` | Agent backend (`copilot` or `claude`) |
| `SANDCASTLE_IMAGE` | `sandcastle:userstory-pipeline` | Podman image name |
| `SANDCASTLE_WORK_DIR` | `.work` (inside this repo) | Local path where target repos are cloned |
| `SANDCASTLE_MAX_AC` | `5` | Acceptance-criteria loop cap before human escalation |
| `SANDCASTLE_MAX_REVIEW` | `5` | Code-review loop cap before human escalation |
| `SANDCASTLE_MAX_IMPLEMENT` | `10` | Safety cap on the implement→test loop |
| `SANDCASTLE_IDLE_TIMEOUT` | `1200` | Per-step agent idle timeout (seconds) |

Inputs can also be supplied via `SANDCASTLE_TITLE`, `SANDCASTLE_DESCRIPTION`,
`SANDCASTLE_REPO`, `SANDCASTLE_BASE_BRANCH` (default `main`).

---

## How the agents are wired

- The **IO contract** (which artifact files exist and the JSON shapes for verdicts) is
  owned by the pipeline code (`src/`). The **role and heuristics** are owned by the
  editable `agents/*.Agents.md` files. The Improve agent edits the latter, never the
  former — so self-improvement can't break the machinery.
- The prompt for each step is composed in `src/agents.ts` as: a fixed pipeline preamble
  + the role file + run-specific context + the completion-signal instruction.

### Optional capabilities the Improver can add

The improver (step 10) may add reusable capabilities that the pipeline automatically
wires into every future target-repo run:

- `agents/hooks.json` — Sandcastle sandbox hooks (e.g. a `dotnet restore` /
  `npm ci` on `onSandboxReady`) to make later steps more reliable.
- `agents/mcp.json` — copied into each target repo as `.mcp.json` (MCP servers; the
  GitHub Copilot CLI reads project-level `.mcp.json`).
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

```
.sandcastle/
  Containerfile        # Podman image (node + python + dotnet + gh + GitHub Copilot CLI)
  .env.example         # credential template (copy to .env)
agents/
  02-refinement.Agents.md … 12-summarize.Agents.md   # one editable role file per step
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
