/** Resolve and provision the agent credentials Sandcastle needs. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AGENT_BACKEND, ROOT } from "./config.js";
import * as log from "./logger.js";

/**
 * Credential env keys per backend. Sandcastle only injects keys that are *listed*
 * in `.sandcastle/.env`, so we list every accepted key for the active backend.
 *  - GitHub Copilot CLI: COPILOT_GITHUB_TOKEN (preferred) > GH_TOKEN > GITHUB_TOKEN.
 *  - Claude Code CLI:     CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY.
 */
const TOKEN_KEYS: string[] =
  AGENT_BACKEND === "claude"
    ? ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]
    : ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/**
 * Optional BYOK ("Bring Your Own Key") env keys for the GitHub Copilot CLI. These let
 * `copilot` route model requests to a custom OpenAI-, Azure-, or Anthropic-compatible
 * endpoint (e.g. Ollama, LiteLLM, Azure OpenAI) instead of GitHub-hosted models. See:
 * https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models
 * Never required — forwarded into the sandbox only when present, and only for the
 * `copilot` backend (the `claude` backend has no equivalent BYOK mechanism here).
 *
 * Deliberately excludes `COPILOT_MODEL`: the pipeline always passes the model
 * explicitly via `copilot(model)` → `--model` (resolved from `SANDCASTLE_MODEL` /
 * `SANDCASTLE_MODEL_<STEP>`, see `config.ts#modelFor`), so setting `COPILOT_MODEL`
 * here would be redundant and could silently diverge from the per-step model.
 */
const BYOK_KEYS: string[] =
  AGENT_BACKEND === "copilot"
    ? [
        "COPILOT_PROVIDER_BASE_URL",
        "COPILOT_PROVIDER_TYPE",
        "COPILOT_PROVIDER_API_KEY",
        "COPILOT_OFFLINE",
      ]
    : [];

/**
 * Env keys referenced by `agents/mcp.json` (MCP server config copied into every
 * target repo, see `capabilities.ts#provisionCapabilities`). Forwarded into the
 * sandbox's `.sandcastle/.env` alongside the agent-chat credentials whenever present,
 * so `${GITHUB_PERSONAL_ACCESS_TOKEN}` in `.mcp.json` resolves inside the sandbox.
 * Never required — the GitHub MCP server simply won't authenticate if unset.
 */
const MCP_KEYS: string[] = ["GITHUB_PERSONAL_ACCESS_TOKEN"];

const MISSING_CREDS_MESSAGE =
  AGENT_BACKEND === "claude"
    ? "No Claude credentials found. Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) " +
      "or ANTHROPIC_API_KEY in .sandcastle/.env (copy from .sandcastle/.env.example)."
    : "No GitHub Copilot credentials found. Set a GitHub token with the \"Copilot Requests\" " +
      "permission as COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) in .sandcastle/.env " +
      "(copy from .sandcastle/.env.example), or configure a BYOK provider via " +
      "COPILOT_PROVIDER_BASE_URL (see the README's 'Using your own models (BYOK)' section). " +
      "A token from `gh auth login` works.";

/** Parse a dotenv-style file into a key/value map (best effort). */
function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
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
    out[key] = value;
  }
  return out;
}

let cached: Record<string, string> | null = null;

/**
 * Read the orchestrator's `.sandcastle/.env`, merge any matching values already in
 * `process.env`, mirror them back into `process.env`, and return the credential map.
 * Throws if no usable token is found.
 */
export async function resolveCredentials(): Promise<Record<string, string>> {
  if (cached) return cached;
  const envPath = join(ROOT, ".sandcastle", ".env");
  let fileVars: Record<string, string> = {};
  if (existsSync(envPath)) {
    fileVars = parseEnv(await readFile(envPath, "utf8"));
  }

  const creds: Record<string, string> = {};
  for (const key of [...TOKEN_KEYS, ...BYOK_KEYS, ...MCP_KEYS]) {
    const value = fileVars[key] || process.env[key];
    if (value) {
      creds[key] = value;
      process.env[key] = value;
    }
  }

  // A BYOK provider (COPILOT_PROVIDER_BASE_URL) is a valid credential on its own —
  // it routes Copilot CLI to a custom endpoint instead of GitHub-hosted models.
  const hasByokProvider = Boolean(creds["COPILOT_PROVIDER_BASE_URL"]);
  if (!TOKEN_KEYS.some((k) => creds[k]) && !hasByokProvider) {
    throw new Error(MISSING_CREDS_MESSAGE);
  }
  cached = creds;
  return creds;
}

/**
 * Sandcastle resolves agent env from `<cwd>/.sandcastle/.env` — and only injects keys
 * that are *listed* in that file. So we must write a `.sandcastle/.env` into every repo
 * we run against (the target clone) containing the credential keys.
 */
export async function provisionEnvInto(repoDir: string): Promise<void> {
  const creds = await resolveCredentials();
  const dir = join(repoDir, ".sandcastle");
  await mkdir(dir, { recursive: true });
  const body =
    [...TOKEN_KEYS, ...BYOK_KEYS, ...MCP_KEYS]
      .filter((k) => creds[k])
      .map((k) => `${k}=${creds[k]}`)
      .join("\n") + "\n";
  await writeFile(join(dir, ".env"), body, "utf8");
  log.detail(`Provisioned credentials into ${repoDir}\\.sandcastle\\.env`);
}

/**
 * Token keys accepted for pushing branches and opening pull requests (step 13). Kept
 * distinct from `TOKEN_KEYS` (Copilot/Claude chat auth): opening a PR needs a token
 * whose scope/permission covers `Contents` (or `repo` on a classic PAT) and
 * `Pull requests`, which the Copilot-only "Copilot Requests" permission does not grant.
 * `SANDCASTLE_GITHUB_PR_TOKEN` lets that be configured separately; falls back to the
 * same `GH_TOKEN` / `GITHUB_TOKEN` used elsewhere when they already carry repo scope
 * (e.g. a token from `gh auth login`).
 */
const PR_TOKEN_KEYS: string[] = ["SANDCASTLE_GITHUB_PR_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];

/**
 * Resolve a GitHub token suitable for `git push` + the Pulls API, reading from the
 * orchestrator's `.sandcastle/.env` merged with `process.env`. Returns `undefined`
 * (never throws) when none is configured — the caller decides how to degrade.
 */
export async function resolvePrToken(): Promise<string | undefined> {
  const envPath = join(ROOT, ".sandcastle", ".env");
  let fileVars: Record<string, string> = {};
  if (existsSync(envPath)) {
    fileVars = parseEnv(await readFile(envPath, "utf8"));
  }
  for (const key of PR_TOKEN_KEYS) {
    const value = fileVars[key] || process.env[key];
    if (value) return value;
  }
  return undefined;
}
