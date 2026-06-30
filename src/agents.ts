/** Agent provider construction + prompt composition from the editable role files. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCode, copilot, type AgentProvider } from "@ai-hero/sandcastle";
import { AGENT_BACKEND, AGENTS_DIR, ARTIFACT_DIR, COMPLETION_SIGNAL } from "./config.js";

/** Build the agent provider for a given model, honouring SANDCASTLE_AGENT. */
export function buildAgent(model: string): AgentProvider {
  switch (AGENT_BACKEND) {
    case "claude":
      return claudeCode(model);
    case "copilot":
    default:
      return copilot(model);
  }
}

/** Read an editable role file (e.g. `02-refinement.Agents.md`). */
export async function loadRole(file: string): Promise<string> {
  return readFile(join(AGENTS_DIR, file), "utf8");
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
