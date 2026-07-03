/**
 * Optional, Improver-maintained capabilities wired into every target-repo run:
 *  - `agents/hooks.json`  -> Sandcastle sandbox hooks (e.g. restore/build on ready)
 *  - `agents/mcp.json`    -> copied into the target repo as `.mcp.json`
 *  - `agents/skills/**`   -> copied into the target repo as `.claude/skills/`
 */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SandboxHooks } from "@ai-hero/sandcastle";
import { AGENTS_DIR } from "./config.js";
import * as log from "./logger.js";

/** Load optional sandbox hooks from `agents/hooks.json`. */
export async function loadHooks(): Promise<SandboxHooks | undefined> {
  const path = join(AGENTS_DIR, "hooks.json");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete raw["_comment"];
    const hooks = raw as SandboxHooks;
    const hostReady = hooks.host?.onSandboxReady?.length ?? 0;
    const sbReady = hooks.sandbox?.onSandboxReady?.length ?? 0;
    if (hostReady + sbReady === 0) return undefined;
    log.detail(`Loaded ${hostReady + sbReady} setup hook(s) from agents/hooks.json`);
    return hooks;
  } catch (e) {
    log.warn(`Ignoring agents/hooks.json: ${(e as Error).message}`);
    return undefined;
  }
}

/** Copy optional MCP config and skills into the target repo checkout. */
export async function provisionCapabilities(repoDir: string): Promise<string[]> {
  const provisioned: string[] = [];

  const mcpSrc = join(AGENTS_DIR, "mcp.json");
  if (existsSync(mcpSrc)) {
    try {
      const raw = JSON.parse(await readFile(mcpSrc, "utf8")) as Record<string, unknown>;
      delete raw["_comment"];
      await writeFile(join(repoDir, ".mcp.json"), JSON.stringify(raw, null, 2) + "\n", "utf8");
      provisioned.push(".mcp.json");
    } catch (e) {
      log.warn(`Ignoring agents/mcp.json: ${(e as Error).message}`);
    }
  }

  const skillsSrc = join(AGENTS_DIR, "skills");
  if (existsSync(skillsSrc)) {
    const dest = join(repoDir, ".claude", "skills");
    await mkdir(dest, { recursive: true });
    await cp(skillsSrc, dest, { recursive: true });
    provisioned.push(".claude/skills/");
  }

  if (provisioned.length > 0) {
    log.detail(`Provisioned capabilities: ${provisioned.join(", ")}`);
  }
  return provisioned;
}
