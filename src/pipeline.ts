/**
 * The 12-step user-story pipeline.
 *
 * Steps 2-9 and 12 run inside a single warm Podman sandbox on the target repo so
 * commits and state accumulate on one branch. Test-passing is verified deterministically
 * by the pipeline via `sandbox.exec(testCommand)` — never by the agent. Steps 10-11
 * (self-improvement) run against the orchestrator repo and edit the `agents/*.Agents.md`.
 */
import {
  createSandbox,
  run,
  type Sandbox,
  type SandboxExecOptions,
} from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";

import {
  ARTIFACT_DIR,
  COMPLETION_SIGNAL,
  IDLE_TIMEOUT_SECONDS,
  IMAGE_NAME,
  IMPLEMENT_ITERATIONS,
  MAX_AC_ATTEMPTS,
  MAX_IMPLEMENT_ATTEMPTS,
  MAX_REVIEW_ATTEMPTS,
  ROOT,
  modelFor,
} from "./config.js";
import * as log from "./logger.js";
import type { StoryInputs } from "./inputs.js";
import { RunReport } from "./report.js";
import { buildAgent, composePrompt, loadRole, type PromptSection } from "./agents.js";
import { checkoutBaseBranch, cloneTargetRepo, excludeFromGit } from "./git.js";
import { provisionEnvInto } from "./env.js";
import { loadHooks, provisionCapabilities } from "./capabilities.js";
import { HumanEscalation } from "./escalation.js";
import {
  acceptanceResultSchema,
  codeReviewResultSchema,
  parseJsonLoose,
  summarySchema,
  type AcceptanceResult,
  type CodeReviewResult,
  type Summary,
} from "./schemas.js";
import type { z } from "zod";

const ART = ARTIFACT_DIR;

function shQuote(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

function truncate(s: string, max = 12000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

/** Read an artifact file from inside the sandbox; null if missing. */
async function readArtifact(sandbox: Sandbox, rel: string): Promise<string | null> {
  const res = await sandbox.exec(`cat ${shQuote(`${ART}/${rel}`)}`);
  return res.exitCode === 0 ? res.stdout : null;
}

/** Write an artifact file into the sandbox via stdin (no shell-escaping of content). */
async function writeArtifact(sandbox: Sandbox, rel: string, content: string): Promise<void> {
  await sandbox.exec(`mkdir -p ${shQuote(ART)} && cat > ${shQuote(`${ART}/${rel}`)}`, {
    stdin: content,
  } as SandboxExecOptions);
}

async function artifactExists(sandbox: Sandbox, rel: string): Promise<boolean> {
  const res = await sandbox.exec(`test -f ${shQuote(`${ART}/${rel}`)}`);
  return res.exitCode === 0;
}

interface AgentStepOptions {
  name: string;
  roleFile: string;
  step: string;
  sandbox: Sandbox;
  report: RunReport;
  sections?: PromptSection[];
  maxIterations?: number;
}

/** Run one agent step inside the given sandbox and record it in the report. */
async function runAgentStep(opts: AgentStepOptions): Promise<void> {
  const { name, roleFile, step, sandbox, report, sections = [], maxIterations = 1 } = opts;
  const model = modelFor(step);
  const roleText = await loadRole(roleFile);
  const prompt = composePrompt(roleText, sections);
  const logFile = report.logPathFor(name);
  const started = Date.now();
  log.detail(`agent=${model} → ${name} (max ${maxIterations} iter)`);
  try {
    const result = await sandbox.run({
      agent: buildAgent(model),
      prompt,
      maxIterations,
      name,
      completionSignal: COMPLETION_SIGNAL,
      idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
      logging: { type: "file", path: logFile },
    });
    report.record({
      name,
      status: "ok",
      durationMs: Date.now() - started,
      logFile,
      info: result.completionSignal ? "completed" : "no completion signal",
    });
  } catch (e) {
    report.record({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      logFile,
      info: (e as Error).message,
    });
    throw e;
  }
}

/** Run a verdict step and parse its JSON result, with one repair retry. */
async function runVerdictStep<S extends z.ZodTypeAny>(
  opts: AgentStepOptions & { resultRel: string; schema: S },
): Promise<z.infer<S>> {
  const { sandbox, resultRel, schema } = opts;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const sections = [...(opts.sections ?? [])];
    if (attempt === 2) {
      sections.push({
        heading: "Output repair required",
        body: `Your previous run did not produce a valid \`${ART}/${resultRel}\` matching the required JSON shape. Re-emit ONLY the strict JSON to that exact file.`,
      });
    }
    await runAgentStep({ ...opts, sections });
    const raw = await readArtifact(sandbox, resultRel);
    if (raw !== null) {
      const parsed = parseJsonLoose(raw, schema);
      if (parsed.ok) return parsed.value;
      log.warn(`${opts.name}: ${resultRel} invalid (${parsed.error})`);
    } else {
      log.warn(`${opts.name}: ${resultRel} was not written`);
    }
  }
  throw new HumanEscalation(
    opts.name,
    2,
    `Agent failed to produce a valid ${ART}/${resultRel} after a repair attempt.`,
  );
}

function storySections(inputs: StoryInputs): PromptSection {
  return {
    heading: "User story",
    body: `Title: ${inputs.title}\nRepository: ${inputs.repo}\n\nDescription:\n${inputs.description}`,
  };
}

/**
 * Step 6: implement, then let the PIPELINE run the tests deterministically. Loop until
 * the test command exits 0 or the safety cap is hit (then escalate to a human).
 */
async function implementUntilGreen(
  sandbox: Sandbox,
  report: RunReport,
  inputs: StoryInputs,
  testCommand: string,
  initialFeedback: string,
): Promise<void> {
  let feedback = initialFeedback;
  let lastOutput = "";
  for (let attempt = 1; attempt <= MAX_IMPLEMENT_ATTEMPTS; attempt++) {
    const sections: PromptSection[] = [storySections(inputs)];
    if (feedback) sections.push({ heading: "Feedback for this round", body: feedback });
    if (lastOutput) {
      sections.push({
        heading: "Latest failing test output (from the pipeline's test run)",
        body: "```\n" + truncate(lastOutput, 8000) + "\n```",
      });
    }
    await runAgentStep({
      name: `06-implement-attempt-${attempt}`,
      roleFile: "06-implement.Agents.md",
      step: "implement",
      sandbox,
      report,
      sections,
      maxIterations: IMPLEMENT_ITERATIONS,
    });

    log.detail(`Pipeline running tests deterministically: ${testCommand}`);
    const started = Date.now();
    const res = await sandbox.exec(testCommand);
    const passed = res.exitCode === 0;
    report.record({
      name: `tests-after-implement-${attempt}`,
      status: passed ? "ok" : "failed",
      durationMs: Date.now() - started,
      info: `exit=${res.exitCode}`,
    });
    if (passed) {
      log.info(`Tests passed (exit 0) after implement attempt ${attempt}.`);
      return;
    }
    lastOutput = `${res.stdout}\n${res.stderr}`;
    feedback =
      `The pipeline ran the test command and it FAILED (exit code ${res.exitCode}). ` +
      `Fix the implementation so every test passes. Do not modify or skip tests to pass.`;
    log.warn(`Tests failed (exit ${res.exitCode}) on attempt ${attempt}.`);
  }
  throw new HumanEscalation(
    "implement/tests",
    MAX_IMPLEMENT_ATTEMPTS,
    `Tests still failing after ${MAX_IMPLEMENT_ATTEMPTS} implement attempts.\n\n${truncate(lastOutput)}`,
  );
}

function formatAcIssues(ac: AcceptanceResult): string {
  return ac.issues
    .map((i, n) => `${n + 1}. [${i.ac}] ${i.problem}${i.suggestion ? ` — fix: ${i.suggestion}` : ""}`)
    .join("\n");
}

function formatMustFix(review: CodeReviewResult): string {
  return review.mustFix
    .map((i, n) => `${n + 1}. (${i.area}) ${i.problem}${i.suggestion ? ` — fix: ${i.suggestion}` : ""}`)
    .join("\n");
}

/** Run the orchestrator-side improver steps (10 & 11) against this repo. */
async function runImproverStep(
  report: RunReport,
  name: string,
  roleFile: string,
  step: string,
  extra: PromptSection[],
): Promise<void> {
  const model = modelFor(step);
  const roleText = await loadRole(roleFile);
  const sections: PromptSection[] = [
    {
      heading: "Run under review",
      body: `Run id: ${report.id}\nReport: runs/${report.id}/report.md\nLogs dir: runs/${report.id}/logs/`,
    },
    ...extra,
  ];
  const prompt = composePrompt(roleText, sections);
  const logFile = report.logPathFor(name);
  const started = Date.now();
  log.detail(`agent=${model} → ${name} (orchestrator repo)`);
  try {
    await run({
      agent: buildAgent(model),
      sandbox: podman({ imageName: IMAGE_NAME }),
      cwd: ROOT,
      branchStrategy: { type: "head" },
      prompt,
      maxIterations: 1,
      name,
      completionSignal: COMPLETION_SIGNAL,
      idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
      logging: { type: "file", path: logFile },
    });
    report.record({ name, status: "ok", durationMs: Date.now() - started, logFile });
  } catch (e) {
    report.record({
      name,
      status: "failed",
      durationMs: Date.now() - started,
      logFile,
      info: (e as Error).message,
    });
    log.warn(`${name} failed (non-fatal, continuing): ${(e as Error).message}`);
  }
}

export interface PipelineResult {
  summary?: Summary;
  branch: string;
  clonePath: string;
  worktreePreserved?: string;
}

export async function runPipeline(
  inputs: StoryInputs,
  report: RunReport,
): Promise<PipelineResult> {
  // ---- Step 1: gather information (already collected) + prepare the checkout ----
  log.step("1", "Get information & prepare target repository");
  const clonePath = await cloneTargetRepo(inputs.repo);
  await checkoutBaseBranch(clonePath, inputs.baseBranch);
  await excludeFromGit(clonePath, [".sandcastle/", ".mcp.json", ".claude/"]);
  await provisionEnvInto(clonePath);
  const provisioned = await provisionCapabilities(clonePath);
  const hooks = await loadHooks();
  report.record({
    name: "01-prepare",
    status: "ok",
    info: `clone=${clonePath}; base=${inputs.baseBranch}${provisioned.length ? `; capabilities=${provisioned.join(",")}` : ""}`,
  });

  log.detail(`Creating Podman sandbox on branch ${inputs.branch} (based on ${inputs.baseBranch}) …`);
  const sandbox = await createSandbox({
    branch: inputs.branch,
    sandbox: podman({ imageName: IMAGE_NAME }),
    cwd: clonePath,
    ...(hooks ? { hooks } : {}),
  });

  let worktreePreserved: string | undefined;
  try {
    // Seed the shared story artifact.
    await writeArtifact(
      sandbox,
      "STORY.md",
      `# User Story\n\n## Title\n${inputs.title}\n\n## Repository\n${inputs.repo}\n\n## Description\n${inputs.description}\n`,
    );

    // ---- Step 2: Refinement (Product Owner) ----
    log.step("2", "Refinement — acceptance criteria");
    await runAgentStep({
      name: "02-refinement",
      roleFile: "02-refinement.Agents.md",
      step: "refine",
      sandbox,
      report,
      sections: [storySections(inputs)],
    });

    // ---- Step 3: Technical details ----
    log.step("3", "Technical details");
    await runAgentStep({
      name: "03-technical-details",
      roleFile: "03-technical-details.Agents.md",
      step: "technical",
      sandbox,
      report,
      sections: [storySections(inputs)],
    });

    // ---- Step 4: Plan ----
    log.step("4", "Implementation plan");
    await runAgentStep({
      name: "04-plan",
      roleFile: "04-plan.Agents.md",
      step: "plan",
      sandbox,
      report,
      sections: [storySections(inputs)],
    });

    // ---- Step 5: Write tests (+ discover deterministic test command) ----
    log.step("5", "Write tests");
    await runAgentStep({
      name: "05-write-tests",
      roleFile: "05-write-tests.Agents.md",
      step: "tests",
      sandbox,
      report,
      sections: [storySections(inputs)],
    });
    const testCommandRaw = await readArtifact(sandbox, "05-test-command.txt");
    if (!testCommandRaw || !testCommandRaw.trim()) {
      throw new HumanEscalation(
        "write-tests",
        1,
        `The test author did not write ${ART}/05-test-command.txt, so the pipeline cannot ` +
          `verify tests deterministically.`,
      );
    }
    const testCommand = testCommandRaw.trim().split("\n")[0]!.trim();
    log.info(`Deterministic test command: ${testCommand}`);
    report.record({ name: "05-test-command", status: "ok", info: testCommand });

    // ---- Step 6: Implement until the pipeline's test run is green ----
    log.step("6", "Implement (pipeline-gated on tests)");
    await implementUntilGreen(sandbox, report, inputs, testCommand, "");

    // ---- Steps 7 & 8: acceptance + review remediation loops (back to step 6) ----
    let acAttempts = 0;
    let reviewAttempts = 0;
    let hadPreviousReview = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Step 7: Acceptance criteria
      acAttempts++;
      log.step("7", `Check acceptance criteria (attempt ${acAttempts}/${MAX_AC_ATTEMPTS})`);
      const ac = await runVerdictStep({
        name: `07-acceptance-attempt-${acAttempts}`,
        roleFile: "07-acceptance-criteria.Agents.md",
        step: "acceptance",
        sandbox,
        report,
        resultRel: "07-acceptance-result.json",
        schema: acceptanceResultSchema,
      });
      report.record({
        name: `07-acceptance-verdict-${acAttempts}`,
        status: ac.passed ? "ok" : "failed",
        info: ac.summary,
        attempts: acAttempts,
      });
      if (!ac.passed) {
        if (acAttempts >= MAX_AC_ATTEMPTS) {
          throw new HumanEscalation(
            "acceptance-criteria",
            acAttempts,
            `Acceptance criteria still unmet after ${acAttempts} attempts.\n\n${ac.summary}\n\n${formatAcIssues(ac)}`,
          );
        }
        log.warn(`Acceptance criteria not met; returning to implement.`);
        await implementUntilGreen(
          sandbox,
          report,
          inputs,
          testCommand,
          `Acceptance criteria are NOT yet met. Close these gaps:\n${formatAcIssues(ac)}`,
        );
        continue;
      }
      log.info(`Acceptance criteria satisfied.`);

      // Step 8: Code review
      reviewAttempts++;
      if (hadPreviousReview && (await artifactExists(sandbox, "08-code-review.md"))) {
        await sandbox.exec(
          `cp ${shQuote(`${ART}/08-code-review.md`)} ${shQuote(`${ART}/08-previous-review.md`)}`,
        );
      }
      log.step("8", `Code review (attempt ${reviewAttempts}/${MAX_REVIEW_ATTEMPTS})`);
      const review = await runVerdictStep({
        name: `08-code-review-attempt-${reviewAttempts}`,
        roleFile: "08-code-review.Agents.md",
        step: "review",
        sandbox,
        report,
        resultRel: "08-code-review-result.json",
        schema: codeReviewResultSchema,
      });
      hadPreviousReview = true;
      report.record({
        name: `08-review-verdict-${reviewAttempts}`,
        status: review.approved ? "ok" : "failed",
        info: review.summary,
        attempts: reviewAttempts,
      });
      if (!review.approved) {
        if (reviewAttempts >= MAX_REVIEW_ATTEMPTS) {
          throw new HumanEscalation(
            "code-review",
            reviewAttempts,
            `Code review still requires changes after ${reviewAttempts} attempts.\n\n${review.summary}\n\n${formatMustFix(review)}`,
          );
        }
        log.warn(`Code review requires changes; returning to implement.`);
        await implementUntilGreen(
          sandbox,
          report,
          inputs,
          testCommand,
          `Code review requires changes. Address every must-fix item:\n${formatMustFix(review)}`,
        );
        continue;
      }
      log.info(`Code review approved.`);
      break;
    }

    // ---- Step 9: Commit (deterministic, pipeline-owned) ----
    log.step("9", "Commit final work");
    await runAgentStep({
      name: "09-commit-message",
      roleFile: "09-commit.Agents.md",
      step: "commit",
      sandbox,
      report,
      sections: [storySections(inputs)],
    });
    const commitSha = await commitWork(sandbox, inputs, report);

    // ---- Steps 10 & 11: self-improvement (orchestrator repo) ----
    // Write an interim report so the improver can read what happened.
    report.outcome = "completed";
    await report.write();

    log.step("10", "Improve previous agents");
    await runImproverStep(report, "10-improve", "10-improve.Agents.md", "improve", []);

    log.step("11", "Improve self (the improver)");
    await runImproverStep(report, "11-improve-self", "11-improve-self.Agents.md", "improve-self", []);

    // ---- Step 12: Summarize ----
    log.step("12", "Summarize");
    await runAgentStep({
      name: "12-summarize",
      roleFile: "12-summarize.Agents.md",
      step: "summarize",
      sandbox,
      report,
      sections: [
        storySections(inputs),
        { heading: "Final commit", body: commitSha ? `Committed as ${commitSha}` : "See branch tip." },
      ],
    });
    const summaryRaw = await readArtifact(sandbox, "12-summary.json");
    let summary: Summary | undefined;
    if (summaryRaw) {
      const parsed = parseJsonLoose(summaryRaw, summarySchema);
      if (parsed.ok) summary = parsed.value;
      else log.warn(`12-summary.json invalid: ${parsed.error}`);
    }

    return { summary, branch: inputs.branch, clonePath };
  } finally {
    const close = await sandbox.close();
    worktreePreserved = close.preservedWorktreePath;
    if (worktreePreserved) {
      log.detail(`Worktree preserved at ${worktreePreserved}`);
    }
  }
}

/** Stage everything (minus excluded infra) and commit using the agent's message. */
async function commitWork(
  sandbox: Sandbox,
  inputs: StoryInputs,
  report: RunReport,
): Promise<string | null> {
  const msg =
    (await readArtifact(sandbox, "09-commit-message.txt"))?.trim() ||
    `feat: ${inputs.title}\n\nImplemented via the Sandcastle user-story pipeline.`;

  await sandbox.exec(`git add -A`);
  const commit = await sandbox.exec(
    `git -c user.name='Sandcastle Pipeline' -c user.email='pipeline@sandcastle.local' commit -F -`,
    { stdin: msg } as SandboxExecOptions,
  );
  if (commit.exitCode !== 0) {
    if (/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      log.warn("Nothing to commit (changes may already be committed).");
      report.record({ name: "09-commit", status: "ok", info: "nothing to commit" });
      return null;
    }
    report.record({ name: "09-commit", status: "failed", info: commit.stderr.slice(0, 200) });
    throw new Error(`git commit failed: ${commit.stderr}`);
  }
  const sha = (await sandbox.exec(`git rev-parse HEAD`)).stdout.trim();
  log.info(`Committed ${sha} on ${inputs.branch}.`);
  report.record({ name: "09-commit", status: "ok", info: sha });
  return sha;
}
