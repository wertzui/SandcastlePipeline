# Technical Details

## Overview
This change introduces technology-specific agent role files for steps 5 (write tests) and 6 (implement) to provide specialized guidance for C# and TypeScript projects. The pipeline will detect the primary technology in the target repository and load the appropriate role file, falling back to the existing generic files when no specific variant exists.

## Architecture & Frameworks

### Current Architecture
- **Language**: TypeScript (ES2022, Node 20+)
- **Module System**: ESM with NodeNext resolution
- **Build Tool**: tsx for direct TypeScript execution
- **Type Checking**: TypeScript 5.6 strict mode
- **Dependency**: `@ai-hero/sandcastle` (0.12.0) for agent orchestration and sandbox management
- **Containerization**: Podman-based sandboxes using `@ai-hero/sandcastle/sandboxes/podman`

### Pipeline Architecture
The pipeline follows a 12-step agent workflow where:
1. Steps 2-9 and 12 run in a single warm Podman sandbox on the target repository
2. Steps 10-11 (improvers) run against the orchestrator repository and edit agent role files
3. Agent behavior is defined by editable `.Agents.md` files in the `agents/` directory
4. The pipeline orchestrator (`src/pipeline.ts`) controls the flow and runs deterministic checks
5. Agent role loading is handled by `src/agents.ts` via the `loadRole()` function

## Files Involved

### Existing Files to Modify

**`src/agents.ts`** (19 lines)
- Currently: Simple `loadRole(file: string)` function that reads from `AGENTS_DIR`
- Change: Add technology detection logic and modify role loading to support technology-specific variants
- New functions needed:
  - `detectTechnology(sandbox: Sandbox): Promise<string | null>` - detect C# or TypeScript
  - `loadRoleWithTech(baseFile: string, tech: string | null): Promise<string>` - load tech-specific role or fallback to generic

**`src/pipeline.ts`** (556 lines)
- Currently: Orchestrates 12 steps, calling `loadRole()` directly for each step
- Changes:
  - Detect technology once before step 5 (lines 356-364 in the "Write tests" section)
  - Pass detected technology through to steps 5 and 6 via `runAgentStep()`
  - Store detected tech in a variable and pass to both test-writing and implementation phases
- Specific change points:
  - Line 88-89: `runAgentStep()` signature needs optional `detectedTech?: string | null` parameter
  - Line 91: Change `loadRole(roleFile)` to `loadRoleWithTech(roleFile, detectedTech)`
  - Lines 356-365: Add technology detection before step 5
  - Lines 359, 379: Pass detectedTech to runAgentStep for steps 5 and 6

**`src/config.ts`** (68 lines)
- Currently: Defines constants including `AGENTS_DIR`
- No changes required: All paths and constants remain the same

### New Files to Create

**`agents/05-write-tests.Agents.csharp.md`** (NEW)
- Technology-specific test-writing guidance for C#
- Content: Guidance on xUnit/NUnit/MSTest, FluentAssertions, Moq, .NET testing conventions
- Structure: Mirrors `agents/05-write-tests.Agents.md` with C#-specific instructions

**`agents/05-write-tests.Agents.typescript.md`** (NEW)
- Technology-specific test-writing guidance for TypeScript
- Content: Guidance on Jest/Vitest/Mocha, testing patterns, mocking, TypeScript type safety in tests
- Structure: Mirrors `agents/05-write-tests.Agents.md` with TypeScript-specific instructions

**`agents/06-implement.Agents.csharp.md`** (NEW)
- Technology-specific implementation guidance for C#
- Content: .NET conventions, LINQ, async/await patterns, dependency injection, nullable reference types
- Structure: Mirrors `agents/06-implement.Agents.md` with C#-specific instructions

**`agents/06-implement.Agents.typescript.md`** (NEW)
- Technology-specific implementation guidance for TypeScript
- Content: TypeScript idioms, type safety, discriminated unions, common frameworks (Express, React, etc.)
- Structure: Mirrors `agents/06-implement.Agents.md` with TypeScript-specific instructions

### Files That Remain Unchanged

**`agents/05-write-tests.Agents.md`** (46 lines) - PRESERVED
- Remains as the fallback for technologies without specific variants

**`agents/06-implement.Agents.md`** (37 lines) - PRESERVED
- Remains as the fallback for technologies without specific variants

**All other agent files** (02, 03, 04, 07-12) - NO CHANGES
- Steps 2, 3, 4, 7, 8, 9, 10, 11, 12 are unaffected per AC-12

## Technology Detection Logic

### Detection Heuristics (as specified in AC assumptions)

**C# Detection:**
- Primary indicator: Presence of one or more `.csproj` files anywhere in the repository
- Command: `find . -name "*.csproj" -type f | head -n 1`
- If found → technology = `"csharp"`

**TypeScript Detection:**
- Primary indicator: Presence of `tsconfig.json` in repository root or subdirectories
- Fallback: Count `.ts` files and compare to other source files
- Command sequence:
  1. `test -f tsconfig.json` (root check)
  2. `find . -name "tsconfig.json" -type f | head -n 1` (subdirectory check)
  3. Fallback: Count TypeScript vs other files
- If found → technology = `"typescript"`

**Precedence Rule (AC-10):**
- If both C# and TypeScript detected → C# takes precedence
- Rationale: Backend/service code is typically more central to story implementation

**Fallback:**
- If neither detected → technology = `null`
- When `null`, generic `.Agents.md` files are used

### File Naming Convention
Pattern: `{step-number}-{step-name}.Agents.{technology}.md`

Examples:
- `05-write-tests.Agents.csharp.md`
- `05-write-tests.Agents.typescript.md`
- `06-implement.Agents.csharp.md`
- `06-implement.Agents.typescript.md`

## Data & API Changes

### Function Signatures

**New in `src/agents.ts`:**

```typescript
/**
 * Detect the primary technology in the target repository.
 * Returns "csharp", "typescript", or null.
 */
export async function detectTechnology(sandbox: Sandbox): Promise<string | null>

/**
 * Load a role file with technology-specific variant support.
 * Tries {baseFile without .md}.{tech}.md first, falls back to {baseFile}.
 */
export async function loadRoleWithTech(
  baseFile: string,
  tech: string | null
): Promise<string>
```

**Modified in `src/pipeline.ts`:**

```typescript
interface AgentStepOptions {
  name: string;
  roleFile: string;
  step: string;
  sandbox: Sandbox;
  report: RunReport;
  sections?: PromptSection[];
  maxIterations?: number;
  detectedTech?: string | null;  // NEW: optional technology override
}

async function runAgentStep(opts: AgentStepOptions): Promise<void> {
  // ... existing code ...
  const roleText = await loadRoleWithTech(roleFile, opts.detectedTech ?? null);
  // ... rest unchanged ...
}
```

### No Schema Changes
- No changes to `src/schemas.ts`
- No changes to JSON artifact formats (AcceptanceResult, CodeReviewResult, Summary)
- No changes to artifact file paths in `.sandcastle-workflow/`

### No Configuration Changes
- No new environment variables required
- No changes to `package.json` dependencies
- No changes to `tsconfig.json`

## Dependencies

### Existing Dependencies (no additions)
- **`@ai-hero/sandcastle`** (^0.12.0): Already provides `Sandbox` type and `sandbox.exec()` for running detection commands
- **`zod`** (^3.25.0): Already used for schema validation (not needed for this feature)
- **Node.js built-ins**: `fs/promises`, `path` - already in use

### No New Dependencies Required
All functionality can be implemented using:
- Existing `sandbox.exec()` for running shell commands (technology detection)
- Existing `readFile()` and `existsSync()` for file operations
- Existing TypeScript and Node.js capabilities

## Implementation Strategy

### Phase 1: Technology Detection (AC-1, AC-2, AC-10)
1. Implement `detectTechnology()` in `src/agents.ts`:
   - Run `find . -name "*.csproj" -type f` to check for C#
   - If found, return `"csharp"`
   - Otherwise, check for TypeScript via `tsconfig.json` or `.ts` file count
   - If found, return `"typescript"`
   - Otherwise, return `null`
2. Add logging for detected technology (AC-9)

### Phase 2: Role Loading with Technology Support (AC-3, AC-4, AC-5)
1. Implement `loadRoleWithTech()` in `src/agents.ts`:
   - If `tech` is null, load generic role file
   - Otherwise, construct tech-specific filename (e.g., `05-write-tests.Agents.csharp.md`)
   - Try to read tech-specific file with `existsSync()` check
   - If not found, fall back to generic role file
   - Return the loaded role text
2. Add logging for which file was loaded (AC-9)

### Phase 3: Pipeline Integration (AC-8)
1. Modify `runAgentStep()` in `src/pipeline.ts`:
   - Add `detectedTech?: string | null` to options
   - Change `loadRole(roleFile)` to `loadRoleWithTech(roleFile, opts.detectedTech ?? null)`
2. Detect technology before step 5:
   - Call `detectTechnology(sandbox)` and store result
   - Log the detected technology
3. Pass `detectedTech` to steps 5 and 6:
   - Add to `runAgentStep()` calls for steps 5 and 6
   - Do NOT pass to other steps (they remain technology-agnostic)

### Phase 4: Create Technology-Specific Agent Files (AC-6)
1. Create `agents/05-write-tests.Agents.csharp.md`:
   - Base structure from `agents/05-write-tests.Agents.md`
   - Add C#-specific guidance: xUnit/NUnit/MSTest, FluentAssertions, Moq, .NET idioms
2. Create `agents/05-write-tests.Agents.typescript.md`:
   - Base structure from `agents/05-write-tests.Agents.md`
   - Add TypeScript-specific guidance: Jest/Vitest, TypeScript testing patterns
3. Create `agents/06-implement.Agents.csharp.md`:
   - Base structure from `agents/06-implement.Agents.md`
   - Add C#-specific guidance: .NET conventions, LINQ, async/await, DI
4. Create `agents/06-implement.Agents.typescript.md`:
   - Base structure from `agents/06-implement.Agents.md`
   - Add TypeScript-specific guidance: TypeScript idioms, type safety, frameworks

## Risks & Constraints

### Risks

**Technology Detection Accuracy**
- **Risk**: Detection heuristics may misidentify the primary technology in edge cases (e.g., a TypeScript repo with a sample C# project in `examples/`)
- **Mitigation**: Use strict precedence rules (C# > TypeScript) and look for project files in typical locations (not in `node_modules/`, `vendor/`, etc.)
- **Impact**: Low - worst case is fallback to generic role files

**File System Race Conditions**
- **Risk**: `existsSync()` check followed by `readFile()` could theoretically fail if file is deleted between checks
- **Mitigation**: Use try-catch and fall back to generic role file on any read error
- **Impact**: Very low - files are in version control and not modified during pipeline run

**Sandbox Command Execution**
- **Risk**: Detection commands (`find`, `test`) may behave differently across container environments
- **Mitigation**: Use POSIX-standard commands; the Podman container already has these tools
- **Impact**: Very low - commands are well-established and tested

### Constraints

**Backward Compatibility (AC-11)**
- Generic role files MUST remain unchanged and functional
- Existing repositories without technology-specific files must continue to work
- Constraint: Cannot modify or delete existing `.Agents.md` files

**Performance**
- Technology detection adds one additional `sandbox.exec()` call before step 5
- Estimated overhead: <1 second for `find` commands
- Acceptable: Step 5 typically takes minutes, so <1s overhead is negligible

**Scope Limitation (AC-12)**
- ONLY steps 5 and 6 are affected
- All other agent files (steps 2, 3, 4, 7-12) remain unchanged
- No changes to pipeline.ts outside of steps 5-6 orchestration

**No Runtime Configuration**
- No environment variables for manual technology override (per "out of scope")
- Detection is automatic and deterministic based on repository contents

## Non-Functional Considerations

### Security
- No new security concerns: Detection uses read-only commands (`find`, `test`)
- No code execution from target repository during detection
- All file reads are within the sandboxed environment

### Maintainability
- Clear separation: Technology-specific guidance is isolated in separate files
- Future extensibility: Adding Python, Go, etc. follows the same pattern
- Self-improvement: The Improve agent (step 10) can edit all `.Agents.md` files, including new tech-specific variants

### Observability (AC-9)
- Detection result is logged: "Detected technology: csharp" or "No technology-specific variant found, using generic role"
- Loaded role file is logged: "Loading role: 05-write-tests.Agents.csharp.md" or "Loading role: 05-write-tests.Agents.md (fallback)"
- Logs appear in the pipeline's existing log output via `log.detail()` and `log.info()`

### Testing
- No existing tests in the repository (no `tests/`, `test/`, or `*.test.ts` files)
- Testing strategy: Manual end-to-end testing with sample C# and TypeScript repositories
- Verification approach:
  1. Run pipeline on a C# repository → verify `csharp` files are loaded
  2. Run pipeline on a TypeScript repository → verify `typescript` files are loaded
  3. Run pipeline on a Python repository → verify fallback to generic files
  4. Run pipeline on a mixed C#/TypeScript repository → verify C# precedence

## Test Strategy by Acceptance Criteria

### AC-1: C# Detection
- **Test**: Run pipeline on a repository with `.csproj` files
- **Verification**: Check logs for "Detected technology: csharp" and "Loading role: 05-write-tests.Agents.csharp.md"
- **Test artifacts**: Use a sample .NET repository or create a minimal one with a `.csproj` file

### AC-2: TypeScript Detection
- **Test**: Run pipeline on a repository with `tsconfig.json`
- **Verification**: Check logs for "Detected technology: typescript" and "Loading role: 05-write-tests.Agents.typescript.md"
- **Test artifacts**: Use this repository itself (it has `tsconfig.json`)

### AC-3: Fallback to Generic
- **Test**: Run pipeline on a Python repository (no C# or TypeScript)
- **Verification**: Check logs for "No technology-specific variant" and "Loading role: 05-write-tests.Agents.md (fallback)"
- **Test artifacts**: Create or find a minimal Python repository

### AC-4 & AC-5: Implementation Step Uses Same Technology
- **Test**: Same repositories as AC-1 and AC-2
- **Verification**: Check step 6 logs show same technology and `06-implement.Agents.{tech}.md` loaded
- **No re-detection**: Verify only one "Detected technology" log entry appears (before step 5)

### AC-6: Technology-Specific Files Exist and Differ
- **Test**: Inspect `agents/` directory after implementation
- **Verification**: 
  - All four files exist
  - C# files mention xUnit/NUnit, FluentAssertions, Moq, .NET idioms
  - TypeScript files mention Jest/Vitest, TypeScript patterns
  - Files are not identical to generic versions

### AC-7: Generic Files Unchanged
- **Test**: Compare `agents/05-write-tests.Agents.md` and `agents/06-implement.Agents.md` before and after
- **Verification**: File contents are identical (byte-for-byte comparison)

### AC-8: Consistency Across Steps
- **Test**: Run pipeline and parse logs
- **Verification**: Step 5 and step 6 logs show the same detected technology

### AC-9: Logging
- **Test**: Run pipeline and capture stdout/stderr
- **Verification**: Logs contain:
  - "Detected technology: {csharp|typescript}" or "No technology-specific variant"
  - "Loading role: {filename}"

### AC-10: Mixed Repository Precedence
- **Test**: Create a repository with both `.csproj` and `tsconfig.json`
- **Verification**: Logs show "Detected technology: csharp" (C# takes precedence)

### AC-11: Backward Compatibility
- **Test**: Run pipeline on an existing repository that worked before this change
- **Verification**: Pipeline completes successfully, using either tech-specific or fallback files

### AC-12: Localized Changes
- **Test**: Review git diff after implementation
- **Verification**: Changes are ONLY in:
  - `src/agents.ts` (new functions)
  - `src/pipeline.ts` (detection + passing tech to steps 5 and 6)
  - New files in `agents/` directory
- **No changes to**: Steps 2, 3, 4, 7-12 role files or their orchestration

## Implementation Order

1. **Detection logic** (`detectTechnology` in `src/agents.ts`) - foundation for all other work
2. **Role loading** (`loadRoleWithTech` in `src/agents.ts`) - mechanism for tech-specific files
3. **Pipeline integration** (modify `src/pipeline.ts`) - wire detection and loading together
4. **Technology-specific agent files** (create 4 new `.md` files) - content for specialized guidance
5. **Manual testing** (run pipeline on sample repos) - verify end-to-end functionality

## Success Criteria Summary

The implementation is complete when:
1. Technology detection correctly identifies C# (via `.csproj`) and TypeScript (via `tsconfig.json`)
2. Steps 5 and 6 load technology-specific role files when available
3. Fallback to generic files works when no specific variant exists
4. All 4 technology-specific agent files exist with meaningful, differentiated content
5. Original generic agent files remain unchanged
6. Pipeline logs clearly indicate which role file was loaded
7. Changes are localized to `src/agents.ts`, `src/pipeline.ts`, and new agent files
8. No regressions: Existing repositories continue to work (with fallback or tech-specific files)
9. Manual testing confirms correct behavior for C#, TypeScript, mixed, and other repositories

---

**References:**
- AC-1 through AC-12: See `.sandcastle-workflow/02-acceptance-criteria.md`
- Existing role loading: `src/agents.ts` lines 18-21
- Pipeline orchestration: `src/pipeline.ts` lines 88-123 (runAgentStep), 356-380 (steps 5-6)
- Agent file examples: `agents/05-write-tests.Agents.md`, `agents/06-implement.Agents.md`
