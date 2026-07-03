/** Host-side git helpers (clone the target repo, manage the local checkout). */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { WORK_DIR } from "./config.js";
import * as log from "./logger.js";

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function git(args: string[], cwd?: string): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Normalise a user-supplied repo reference into something `git clone` understands. */
export function normalizeRepo(ref: string): { url: string; name: string } {
  const trimmed = ref.trim();
  // Local path → use as-is.
  if (existsSync(trimmed)) {
    return { url: trimmed, name: basename(trimmed.replace(/[\\/]+$/, "")) };
  }
  // owner/repo shorthand → GitHub https.
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    const name = trimmed.split("/")[1]!.replace(/\.git$/, "");
    return { url: `https://github.com/${trimmed}.git`, name };
  }
  // Full URL (https / ssh).
  const name =
    trimmed
      .replace(/\.git$/, "")
      .split(/[\\/:]/)
      .filter(Boolean)
      .pop() ?? "repo";
  return { url: trimmed, name };
}

/**
 * Clone (or refresh) the target repo into `.work/<name>` and return the absolute path
 * to the checkout. A fresh clone is preferred; an existing checkout is reused after a
 * `git fetch` so re-runs are fast.
 */
export async function cloneTargetRepo(ref: string): Promise<string> {
  const { url, name } = normalizeRepo(ref);
  await mkdir(WORK_DIR, { recursive: true });
  const dest = join(WORK_DIR, name);

  if (existsSync(join(dest, ".git"))) {
    log.detail(`Reusing existing checkout at ${dest} (git fetch)`);
    await git(["fetch", "--all", "--prune"], dest).catch((e) =>
      log.warn(`git fetch failed (continuing with local state): ${(e as Error).message}`),
    );
    return dest;
  }

  log.detail(`Cloning ${url} -> ${dest}`);
  await git(["clone", url, dest]);
  return dest;
}

/**
 * Check out `baseBranch` in the clone so the work branch is created on top of it.
 * Tries the local branch, then `origin/<baseBranch>`. Throws if neither exists.
 */
export async function checkoutBaseBranch(
  repoDir: string,
  baseBranch: string,
): Promise<void> {
  // Already on it?
  const current = await currentBranch(repoDir);
  if (current === baseBranch) {
    await git(["pull", "--ff-only"], repoDir).catch(() => undefined);
    log.detail(`Base branch '${baseBranch}' already checked out.`);
    return;
  }

  // Local branch exists → switch and fast-forward.
  const localExists =
    (await git(["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`], repoDir)
      .then(() => true)
      .catch(() => false));
  if (localExists) {
    await git(["checkout", baseBranch], repoDir);
    await git(["pull", "--ff-only"], repoDir).catch(() => undefined);
    log.detail(`Checked out base branch '${baseBranch}'.`);
    return;
  }

  // Remote-tracking branch exists → create a local branch from it.
  const remoteExists = await git(
    ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${baseBranch}`],
    repoDir,
  )
    .then(() => true)
    .catch(() => false);
  if (remoteExists) {
    await git(["checkout", "-B", baseBranch, `origin/${baseBranch}`], repoDir);
    log.detail(`Checked out base branch '${baseBranch}' from origin.`);
    return;
  }

  throw new Error(
    `Base branch '${baseBranch}' was not found in ${repoDir} (neither a local branch ` +
      `nor origin/${baseBranch}). Pass an existing branch via --base-branch.`,
  );
}

/** Make sure the pipeline's injected credential dir is never committed by an agent. */
export async function excludeFromGit(
  repoDir: string,
  patterns: string[],
): Promise<void> {
  const excludePath = join(repoDir, ".git", "info", "exclude");
  let existing = "";
  if (existsSync(excludePath)) existing = await readFile(excludePath, "utf8");
  const missing = patterns.filter((p) => !existing.includes(p));
  if (missing.length > 0) {
    await appendFile(excludePath, "\n" + missing.join("\n") + "\n", "utf8");
  }
}

export async function currentBranch(repoDir: string): Promise<string> {
  const { stdout } = await git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir);
  return stdout.trim();
}

/** Read the `origin` remote URL configured for a checkout. */
export async function getOriginUrl(repoDir: string): Promise<string> {
  const { stdout } = await git(["remote", "get-url", "origin"], repoDir);
  return stdout.trim();
}

/**
 * Push `branch` to `origin`. When `token` is supplied, authenticates over HTTPS via a
 * transient `Authorization` header (the same technique CI systems use) instead of
 * relying on SSH keys or a stored credential helper on the host.
 */
export async function pushBranch(repoDir: string, branch: string, token?: string): Promise<void> {
  const args = token
    ? [
        "-c",
        `http.https://github.com/.extraheader=AUTHORIZATION: bearer ${token}`,
        "push",
        "-u",
        "origin",
        branch,
      ]
    : ["push", "-u", "origin", branch];
  await git(args, repoDir);
}

/** Parse `{owner, repo}` out of a GitHub remote URL (https or ssh form); null otherwise. */
export function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  const match = url.trim().match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) return null;
  return { owner, repo };
}
