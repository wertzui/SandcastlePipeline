/** Human-escalation signalling. Thrown when a capped loop exhausts its attempts. */

export class HumanEscalation extends Error {
  readonly stage: string;
  readonly attempts: number;
  readonly details: string;

  constructor(stage: string, attempts: number, details: string) {
    super(`Human help required at stage "${stage}" after ${attempts} attempts.`);
    this.name = "HumanEscalation";
    this.stage = stage;
    this.attempts = attempts;
    this.details = details;
  }
}
