/**
 * Static + env-driven configuration for the user-story pipeline.
 *
 * Anything that controls *how the pipeline runs* (models, loop caps, image name,
 * paths) lives here. The behavioural instructions for each agent live in the
 * editable `agents/*.Agents.md` files.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the orchestrator project root (this repo). */
export const ROOT = resolve(here, "..");

/**
 * Load `.sandcastle/.env` into `process.env` for the orchestrator process itself,
 * BEFORE any of the env-driven constants below are resolved.
 *
 * Without this, a value like `SANDCASTLE_MODEL` set only in that file (never
 * exported in the shell) would be silently ignored here: `env.ts#resolveCredentials`
 * only mirrors a whitelist of *credential* keys back into `process.env` (and does so
 * lazily, inside `main()` — well after this module's top-level constants, such as
 * `DEFAULT_MODEL` below, have already been computed from a stale `process.env`).
 * File values win over an already-set `process.env` entry, matching the precedence
 * `env.ts`'s credential resolution already uses.
 */
function loadOrchestratorDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (value) process.env[key] = value;
  }
}
loadOrchestratorDotEnv(join(ROOT, ".sandcastle", ".env"));

/** Directory holding the editable agent role files. */
export const AGENTS_DIR = resolve(ROOT, "agents");

/** Where cloned target repositories live (git-ignored). Override with `SANDCASTLE_WORK_DIR`. */
export const WORK_DIR = process.env.SANDCASTLE_WORK_DIR
  ? resolve(process.env.SANDCASTLE_WORK_DIR)
  : resolve(ROOT, ".work");

/** Where per-run reports/logs are written (git-ignored). */
export const RUNS_DIR = resolve(ROOT, "runs");

/** Directory (inside the target repo) where the pipeline stores its artifacts. */
export const ARTIFACT_DIR = ".sandcastle-workflow";

/** Podman image built from `.sandcastle/Containerfile`. */
export const IMAGE_NAME =
  process.env.SANDCASTLE_IMAGE ?? "sandcastle:userstory-pipeline";

/** Default model used for every step unless a per-step override is set. */
const DEFAULT_MODEL = process.env.SANDCASTLE_MODEL ?? "claude-sonnet-4.5";

/** Agent backend; only `copilot` and `claude` are wired up (both take `(model, opts)`). */
export const AGENT_BACKEND = (process.env.SANDCASTLE_AGENT ?? "copilot") as
  | "copilot"
  | "claude";

/** Per-step model resolution (env override -> global default). */
export function modelFor(step: string): string {
  const key = `SANDCASTLE_MODEL_${step.toUpperCase()}`;
  return process.env[key] ?? DEFAULT_MODEL;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Loop caps. The acceptance and review loops are capped at 5 -> human escalation. */
export const MAX_AC_ATTEMPTS = intEnv("SANDCASTLE_MAX_AC", 5);
export const MAX_REVIEW_ATTEMPTS = intEnv("SANDCASTLE_MAX_REVIEW", 5);

/** Safety cap for the "implement until the pipeline's test run is green" loop. */
export const MAX_IMPLEMENT_ATTEMPTS = intEnv("SANDCASTLE_MAX_IMPLEMENT", 10);

/** Max agent iterations Sandcastle runs inside a single implement invocation. */
export const IMPLEMENT_ITERATIONS = intEnv("SANDCASTLE_IMPLEMENT_ITERATIONS", 1);

/** Idle timeout (seconds) handed to long agent steps. */
export const IDLE_TIMEOUT_SECONDS = intEnv("SANDCASTLE_IDLE_TIMEOUT", 1200);

/** Completion signal every agent is asked to print when its step is done. */
export const COMPLETION_SIGNAL = "<promise>COMPLETE</promise>";
