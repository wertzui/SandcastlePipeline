/** Gather the user story inputs (title, description, target repo). */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export interface StoryInputs {
  title: string;
  description: string;
  repo: string;
  slug: string;
  branch: string;
  baseBranch: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1]!;
    if (m[2] !== undefined) {
      out[key] = m[2];
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

export function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "story";
}

async function prompt(question: string, required = true): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    let answer = "";
    do {
      answer = (await rl.question(question)).trim();
    } while (required && !answer);
    return answer;
  } finally {
    rl.close();
  }
}

/** Prompt with a default applied when the user just presses Enter. */
async function promptWithDefault(question: string, fallback: string): Promise<string> {
  const answer = await prompt(`${question} [${fallback}]: `, false);
  return answer || fallback;
}

/**
 * Resolve inputs from CLI flags (`--title`, `--description`, `--repo`, `--base-branch`),
 * then env (`SANDCASTLE_TITLE` / `_DESCRIPTION` / `_REPO` / `_BASE_BRANCH`), then an
 * interactive prompt. The base branch defaults to `main`.
 */
export async function gatherInputs(argv: string[]): Promise<StoryInputs> {
  const args = parseArgs(argv);

  let title = args["title"] ?? process.env.SANDCASTLE_TITLE ?? "";
  let description = args["description"] ?? process.env.SANDCASTLE_DESCRIPTION ?? "";
  let repo = args["repo"] ?? process.env.SANDCASTLE_REPO ?? "";
  let baseBranch =
    args["base-branch"] ?? args["base"] ?? process.env.SANDCASTLE_BASE_BRANCH ?? "";

  const interactive = stdin.isTTY === true;

  if (!title) {
    if (!interactive) throw new Error("Missing --title (and not a TTY for prompting).");
    title = await prompt("User story title: ");
  }
  if (!description) {
    if (!interactive) throw new Error("Missing --description.");
    description = await prompt("Description: ");
  }
  if (!repo) {
    if (!interactive) throw new Error("Missing --repo (URL, owner/repo, or local path).");
    repo = await prompt("Target GitHub repository (URL / owner/repo / path): ");
  }
  if (!baseBranch) {
    baseBranch = interactive
      ? await promptWithDefault("Base branch to build on", "main")
      : "main";
  }

  const slug = slugify(title);
  const branch = args["branch"] ?? `sandcastle/${slug}`;
  return { title, description, repo, slug, branch, baseBranch };
}
