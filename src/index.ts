/**
 * CLI entry point for the Sandcastle user-story pipeline.
 *
 *   npm run pipeline -- --title "..." --description "..." --repo owner/name
 *
 * Missing inputs are prompted for interactively. Requires a running Podman machine and
 * a GitHub Copilot token in `.sandcastle/.env`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { IMAGE_NAME, ROOT } from "./config.js";
import * as log from "./logger.js";
import { gatherInputs } from "./inputs.js";
import { resolveCredentials } from "./env.js";
import { RunReport } from "./report.js";
import { runPipeline } from "./pipeline.js";
import { HumanEscalation } from "./escalation.js";

const execFileAsync = promisify(execFile);

/** Ensure the orchestrator repo is a git repo (the self-improvement steps need one). */
async function ensureOrchestratorGit(): Promise<void> {
  if (existsSync(join(ROOT, ".git"))) return;
  log.detail("Initialising orchestrator git repository …");
  await execFileAsync("git", ["init", "-b", "main"], { cwd: ROOT });
  await execFileAsync("git", ["add", "-A"], { cwd: ROOT });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Sandcastle Pipeline",
      "-c",
      "user.email=pipeline@sandcastle.local",
      "commit",
      "-m",
      "chore: scaffold sandcastle user-story pipeline",
    ],
    { cwd: ROOT },
  ).catch(() => log.warn("Initial orchestrator commit skipped."));
}

async function podmanReady(): Promise<void> {
  try {
    await execFileAsync("podman", ["info", "--format", "{{.Host.Arch}}"]);
  } catch {
    throw new Error(
      "Podman does not appear to be ready. Start it (e.g. `podman machine start`) and retry.",
    );
  }
}

async function ensureImage(): Promise<void> {
  const exists = await execFileAsync("podman", ["image", "exists", IMAGE_NAME])
    .then(() => true)
    .catch(() => false);
  if (exists) {
    log.detail(`Using existing image ${IMAGE_NAME}.`);
    return;
  }
  log.info(`Image ${IMAGE_NAME} not found — building it (this can take several minutes) …`);
  await execFileAsync(
    "npx",
    ["@ai-hero/sandcastle", "podman", "build-image", "--image-name", IMAGE_NAME],
    { cwd: ROOT, maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" },
  );
  log.info(`Built image ${IMAGE_NAME}.`);
}

function printSummary(summary: { productOwnerSummary: string; technicalSummary: string }): void {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                    PIPELINE SUMMARY                       ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log("──── For the Product Owner ───────────────────────────────");
  console.log(summary.productOwnerSummary.trim());
  console.log("");
  console.log("──── For the Lead Developer / Architect ──────────────────");
  console.log(summary.technicalSummary.trim());
  console.log("");
}

async function main(): Promise<number> {
  const inputs = await gatherInputs(process.argv.slice(2));
  log.info(
    `Story: "${inputs.title}"  →  ${inputs.repo}  (branch ${inputs.branch} ← base ${inputs.baseBranch})`,
  );

  await resolveCredentials();
  await podmanReady();
  await ensureOrchestratorGit();
  await ensureImage();

  const report = new RunReport(inputs);
  await report.init();

  try {
    const result = await runPipeline(inputs, report);
    report.outcome = "completed";
    const reportPath = await report.write();
    log.info(`Run report: ${reportPath}`);

    console.log("");
    log.info(`✅ Done. Work committed on branch '${result.branch}' in ${result.clonePath}.`);
    if (result.pullRequestUrl) {
      log.info(`🔗 Pull request: ${result.pullRequestUrl}`);
    } else {
      log.warn(
        `No pull request was opened (see the run report for details); the branch ` +
          `'${result.branch}' is committed and ready to push/PR manually if needed.`,
      );
    }
    if (result.summary) {
      printSummary(result.summary);
    } else {
      log.warn("No machine-readable summary was produced; see .sandcastle-workflow/12-summary.md.");
    }
    return 0;
  } catch (e) {
    if (e instanceof HumanEscalation) {
      report.setEscalation(e.stage, e.attempts, e.details);
      const reportPath = await report.write();
      console.log("");
      log.error(
        `🛑 HUMAN HELP REQUIRED at stage "${e.stage}" after ${e.attempts} attempts. ` +
          `The pipeline stopped as designed.`,
      );
      log.error(`Details and full report: ${reportPath}`);
      console.log("");
      console.log(e.details.slice(0, 2000));
      return 2;
    }
    report.outcome = "error";
    await report.write().catch(() => undefined);
    log.error(`Pipeline error: ${(e as Error).stack ?? (e as Error).message}`);
    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log.error(String(e?.stack ?? e));
    process.exit(1);
  });
