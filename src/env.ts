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

const MISSING_CREDS_MESSAGE =
  AGENT_BACKEND === "claude"
    ? "No Claude credentials found. Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) " +
      "or ANTHROPIC_API_KEY in .sandcastle/.env (copy from .sandcastle/.env.example)."
    : "No GitHub Copilot credentials found. Set a GitHub token with the \"Copilot Requests\" " +
      "permission as COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) in .sandcastle/.env " +
      "(copy from .sandcastle/.env.example). A token from `gh auth login` works.";

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
  for (const key of TOKEN_KEYS) {
    const value = fileVars[key] || process.env[key];
    if (value) {
      creds[key] = value;
      process.env[key] = value;
    }
  }

  if (!TOKEN_KEYS.some((k) => creds[k])) {
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
    TOKEN_KEYS.filter((k) => creds[k])
      .map((k) => `${k}=${creds[k]}`)
      .join("\n") + "\n";
  await writeFile(join(dir, ".env"), body, "utf8");
  log.detail(`Provisioned credentials into ${repoDir}\\.sandcastle\\.env`);
}
