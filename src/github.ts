/**
 * Minimal GitHub REST API client for opening pull requests. Deliberately dependency-free
 * (uses the platform `fetch`) rather than pulling in an SDK for a single call.
 */
import * as log from "./logger.js";

const API_BASE = "https://api.github.com";

export interface CreatePrOptions {
  token: string;
  owner: string;
  repo: string;
  /** The branch containing the work (compare branch). */
  head: string;
  /** The branch to merge into (e.g. `main`). */
  base: string;
  title: string;
  body: string;
}

export interface CreatePrResult {
  url: string;
  number: number;
}

async function githubRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sandcastle-userstory-pipeline",
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Open a pull request `head` -> `base`. If a pull request for this `head` branch is
 * already open (e.g. re-running the pipeline for the same story), returns the existing
 * PR instead of failing.
 */
export async function createPullRequest(opts: CreatePrOptions): Promise<CreatePrResult> {
  const { token, owner, repo, head, base, title, body } = opts;
  const res = await githubRequest(`/repos/${owner}/${repo}/pulls`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (res.ok) {
    const json = (await res.json()) as { html_url: string; number: number };
    return { url: json.html_url, number: json.number };
  }

  const errText = await res.text().catch(() => "");
  // A pull request already exists for this head branch -> look it up and reuse it.
  if (res.status === 422 && /already exists/i.test(errText)) {
    const existing = await githubRequest(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
      token,
    );
    if (existing.ok) {
      const list = (await existing.json()) as { html_url: string; number: number }[];
      if (list[0]) {
        log.detail(`Pull request already exists for '${head}': ${list[0].html_url}`);
        return { url: list[0].html_url, number: list[0].number };
      }
    }
  }
  throw new Error(`GitHub API error creating pull request (${res.status}): ${errText.slice(0, 500)}`);
}
