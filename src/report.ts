/** Per-run report + log directory used by the pipeline and the Improver agent. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RUNS_DIR } from "./config.js";
import type { StoryInputs } from "./inputs.js";

export type StepStatus = "ok" | "failed" | "escalated" | "skipped";

export interface StepRecord {
  name: string;
  status: StepStatus;
  attempts?: number;
  info?: string;
  durationMs?: number;
  logFile?: string;
}

function fsTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "Z");
}

export class RunReport {
  readonly id: string;
  readonly dir: string;
  readonly logsDir: string;
  readonly inputs: StoryInputs;
  readonly steps: StepRecord[] = [];
  readonly startedAt = Date.now();
  escalation?: { stage: string; attempts: number; details: string };
  outcome: "completed" | "escalated" | "error" | "running" = "running";

  constructor(inputs: StoryInputs) {
    this.inputs = inputs;
    this.id = `${fsTimestamp()}__${inputs.slug}`;
    this.dir = join(RUNS_DIR, this.id);
    this.logsDir = join(this.dir, "logs");
  }

  async init(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
  }

  /** Absolute path for a step's Sandcastle log file. */
  logPathFor(name: string): string {
    return join(this.logsDir, `${name}.log`);
  }

  record(rec: StepRecord): void {
    this.steps.push(rec);
  }

  setEscalation(stage: string, attempts: number, details: string): void {
    this.escalation = { stage, attempts, details };
    this.outcome = "escalated";
  }

  private render(): string {
    const lines: string[] = [];
    lines.push(`# Pipeline Run Report`);
    lines.push("");
    lines.push(`- **Run id:** ${this.id}`);
    lines.push(`- **Outcome:** ${this.outcome}`);
    lines.push(`- **Title:** ${this.inputs.title}`);
    lines.push(`- **Repository:** ${this.inputs.repo}`);
    lines.push(`- **Branch:** ${this.inputs.branch}`);
    lines.push(`- **Base branch:** ${this.inputs.baseBranch}`);
    lines.push(`- **Duration:** ${Math.round((Date.now() - this.startedAt) / 1000)}s`);
    lines.push("");
    lines.push(`## Description`);
    lines.push("");
    lines.push(this.inputs.description);
    lines.push("");
    lines.push(`## Steps`);
    lines.push("");
    lines.push(`| # | Step | Status | Attempts | Info | Log |`);
    lines.push(`|---|------|--------|----------|------|-----|`);
    this.steps.forEach((s, i) => {
      const dur = s.durationMs ? ` (${Math.round(s.durationMs / 1000)}s)` : "";
      const info = (s.info ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 240);
      const logRel = s.logFile ? `logs/${s.logFile.split(/[\\/]/).pop()}` : "";
      lines.push(
        `| ${i + 1} | ${s.name}${dur} | ${s.status} | ${s.attempts ?? ""} | ${info} | ${logRel} |`,
      );
    });
    lines.push("");
    if (this.escalation) {
      lines.push(`## ⚠ Human escalation`);
      lines.push("");
      lines.push(`- **Stage:** ${this.escalation.stage}`);
      lines.push(`- **Attempts:** ${this.escalation.attempts}`);
      lines.push("");
      lines.push("```");
      lines.push(this.escalation.details.slice(0, 4000));
      lines.push("```");
      lines.push("");
    }
    return lines.join("\n");
  }

  async write(): Promise<string> {
    await this.init();
    const path = join(this.dir, "report.md");
    await writeFile(path, this.render(), "utf8");
    return path;
  }
}
