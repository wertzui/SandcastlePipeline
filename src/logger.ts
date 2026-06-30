/** Minimal timestamped logger with step framing. */

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export function info(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`[${ts()}] ⚠  ${msg}`);
}

export function error(msg: string): void {
  console.error(`[${ts()}] ✖  ${msg}`);
}

export function step(n: string, title: string): void {
  console.log("");
  console.log(`════════════════════════════════════════════════════════════`);
  console.log(`  STEP ${n}: ${title}`);
  console.log(`════════════════════════════════════════════════════════════`);
}

export function detail(msg: string): void {
  console.log(`    ${msg}`);
}
