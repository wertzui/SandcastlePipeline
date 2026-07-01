/**
 * Static + env-driven configuration for the user-story pipeline.
 *
 * Anything that controls *how the pipeline runs* (models, loop caps, image name,
 * paths) lives here. The behavioural instructions for each agent live in the
 * editable `agents/*.Agents.md` files.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the orchestrator project root (this repo). */
export const ROOT = resolve(here, "..");

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
