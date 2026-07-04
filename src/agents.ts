/** Agent provider construction + prompt composition from the editable role files. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode, copilot, type AgentProvider } from "@ai-hero/sandcastle";
import { AGENT_BACKEND, AGENTS_DIR, ARTIFACT_DIR, COMPLETION_SIGNAL } from "./config.js";
import * as log from "./logger.js";

/** Build the agent provider for a given model, honouring SANDCASTLE_AGENT. */
export function buildAgent(model: string): AgentProvider {
  switch (AGENT_BACKEND) {
    case "claude":
      return claudeCode(model);
    case "copilot":
    default:
      // The pipeline drives Copilot CLI non-interactively (`copilot -p ...`), which by
      // default skips loading repository-level hooks (`.github/hooks/*.json`) for
      // security — see https://docs.github.com/copilot/reference/hooks-reference. This
      // pipeline provisions its own trusted hook file (see capabilities.ts,
      // agents/copilot-hooks.json), so it's safe to opt back in here.
      return copilot(model, { env: { GITHUB_COPILOT_PROMPT_MODE_REPO_HOOKS: "true" } });
  }
}

/** Read an editable role file (e.g. `02-refinement.Agents.md`). */
export async function loadRole(file: string): Promise<string> {
  return readFile(join(AGENTS_DIR, file), "utf8");
}

/**
 * Detect the primary technology in the target repository.
 * Returns "csharp", "typescript", or null.
 */
export async function detectTechnology(sandbox: any): Promise<string | null> {
  try {
    // AC-1, AC-10: Check for C# first (takes precedence)
    const csharpCheck = await sandbox.exec('find . -name "*.csproj" -type f 2>/dev/null | head -n 1');
    if (csharpCheck.exitCode === 0 && csharpCheck.stdout.trim()) {
      return 'csharp';
    }

    // AC-2: Check for TypeScript
    const tsCheck = await sandbox.exec('find . -name "tsconfig.json" -type f 2>/dev/null | head -n 1');
    if (tsCheck.exitCode === 0 && tsCheck.stdout.trim()) {
      return 'typescript';
    }

    // AC-3: No specific technology detected
    return null;
  } catch (error) {
    // Handle errors gracefully - return null on any error
    return null;
  }
}

/**
 * Load a role file with technology-specific variant support.
 * Tries {baseFile without .md}.{tech}.md first, falls back to {baseFile}.
 */
export async function loadRoleWithTech(
  baseFile: string,
  tech: string | null
): Promise<string> {
  // AC-3: If tech is null, load generic file
  if (tech === null) {
    log.info(`Loading role: ${baseFile} (fallback)`);
    return loadRole(baseFile);
  }

  // Construct tech-specific filename: e.g., "05-write-tests.Agents.md" -> "05-write-tests.Agents.csharp.md"
  const techSpecificFile = baseFile.replace(/\.md$/, `.${tech}.md`);
  const techSpecificPath = join(AGENTS_DIR, techSpecificFile);

  try {
    // AC-4, AC-5: Try to load tech-specific file
    const { existsSync } = await import('node:fs');
    if (existsSync(techSpecificPath)) {
      try {
        const content = await readFile(techSpecificPath, 'utf8');
        log.info(`Loading role: ${techSpecificFile}`);
        return content;
      } catch (error) {
        // Fall through to generic file on read error
      }
    }
  } catch (error) {
    // Fall through to generic file
  }

  // AC-3: Fallback to generic file
  log.info(`Loading role: ${baseFile} (fallback)`);
  return loadRole(baseFile);
}

export interface PromptSection {
  heading: string;
  body: string;
}

/**
 * Compose the final prompt handed to an agent: a fixed pipeline preamble, the editable
 * role spec, the run-specific context, and the completion instruction. Built in JS so
 * we control interpolation (inline prompts get no {{}} substitution from Sandcastle).
 */
export function composePrompt(
  roleText: string,
  sections: PromptSection[] = [],
): string {
  const context = sections
    .map((s) => `### ${s.heading}\n${s.body.trim()}`)
    .join("\n\n");

  return [
    "You are one specialized agent in an automated, multi-step software-delivery pipeline.",
    "You are running autonomously inside a sandboxed git checkout; make your changes directly on disk.",
    `Shared artifacts for this story live in the \`${ARTIFACT_DIR}/\` directory at the repository root — read the inputs named in your role spec from there and write your outputs there exactly as specified.`,
    "The ROLE SPEC below is the authoritative description of your task for this step. Follow it precisely, including the exact output filenames and (where given) JSON shapes.",
    "",
    "──────────────────────── ROLE SPEC ────────────────────────",
    roleText.trim(),
    context ? "\n──────────────────────── RUN CONTEXT ────────────────────────\n" + context : "",
    "",
    "──────────────────────── COMPLETION ────────────────────────",
    `When, and only when, your step is fully finished and all required output files are written, print this exact line on its own:`,
    COMPLETION_SIGNAL,
  ].join("\n");
}
