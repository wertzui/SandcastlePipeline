# Implementation Plan

## Overview
This implementation adds technology-specific agent role files for test-writing (step 5) and implementation (step 6) to provide specialized guidance for C# and TypeScript projects. The pipeline will detect the primary technology in the target repository and load the appropriate role file, falling back to existing generic files when no specific variant exists.

## Implementation Steps

### Step 1: Implement Technology Detection Function
**File**: `src/agents.ts`

**Changes**:
- Add a new exported function `detectTechnology(sandbox: Sandbox): Promise<string | null>`
- Detection logic:
  1. First, check for C# by executing `find . -name "*.csproj" -type f | head -n 1` in the sandbox
  2. If found, return `"csharp"`
  3. Otherwise, check for TypeScript by executing `find . -name "tsconfig.json" -type f | head -n 1`
  4. If found, return `"typescript"`
  5. If neither found, return `null`
- Add appropriate error handling with try-catch blocks
- Use `sandbox.exec()` to run detection commands
- Add logging with `log.detail()` to show detection results

**Dependencies**: None

**Acceptance Criteria**: Contributes to AC-1, AC-2, AC-10

**Implementation Notes**:
- Use POSIX-standard commands (`find`, `test`) that work in Podman containers
- Detection prioritizes C# over TypeScript per the precedence rule
- Commands should ignore common non-source directories (detection runs from repo root)

---

### Step 2: Implement Technology-Aware Role Loading
**File**: `src/agents.ts`

**Changes**:
- Add a new exported function `loadRoleWithTech(baseFile: string, tech: string | null): Promise<string>`
- Logic:
  1. If `tech` is `null`, call and return `loadRole(baseFile)`
  2. Otherwise, construct the tech-specific filename:
     - Parse `baseFile` to extract base name (e.g., `"05-write-tests.Agents.md"` → `"05-write-tests.Agents"`)
     - Build tech-specific path: `{baseName}.{tech}.md` (e.g., `"05-write-tests.Agents.csharp.md"`)
  3. Check if tech-specific file exists using `existsSync()` from `node:fs`
  4. If exists, read and return the tech-specific file
  5. If not exists, fall back to generic file via `loadRole(baseFile)`
- Add logging with `log.info()` showing which file was loaded (generic vs tech-specific)
- Include "(fallback)" in log message when using generic file

**Dependencies**: Depends on Step 1 conceptually (tech value comes from detection)

**Acceptance Criteria**: Contributes to AC-3, AC-4, AC-5, AC-9

**Implementation Notes**:
- Use absolute path construction with `join(AGENTS_DIR, filename)` from existing pattern
- Wrap file reads in try-catch to gracefully handle missing tech-specific files
- Log format: `"Loading role: {filename}"` or `"Loading role: {filename} (fallback)"`

---

### Step 3: Update runAgentStep to Support Technology Parameter
**File**: `src/pipeline.ts`

**Changes**:
- Modify the `AgentStepOptions` interface (around line 77) to add:
  ```typescript
  detectedTech?: string | null;
  ```
- Modify `runAgentStep()` function (around line 88-91):
  - Change line 91 from `const roleText = await loadRole(roleFile);`
  - To: `const roleText = await loadRoleWithTech(roleFile, opts.detectedTech ?? null);`
- Import the new `loadRoleWithTech` function at the top of the file

**Dependencies**: Depends on Step 2

**Acceptance Criteria**: Contributes to AC-4, AC-5, AC-8

**Implementation Notes**:
- Make `detectedTech` optional to maintain backward compatibility
- Default to `null` if not provided (enables fallback behavior)
- No changes needed to other agent steps (2, 3, 4, 7-12)

---

### Step 4: Integrate Technology Detection into Pipeline
**File**: `src/pipeline.ts`

**Changes**:
- Before step 5 (around line 356, just after step 4 completes):
  1. Add a call to `detectTechnology(sandbox)` and store result in a variable
  2. Add logging: `log.info(\`Detected technology: \${detectedTech ?? 'none (using generic roles)'}\`);`
- Modify the step 5 `runAgentStep()` call (line 357-364):
  - Add `detectedTech` to the options object
- Modify the step 6 implementation calls (line 380 and within `implementUntilGreen`):
  - Pass `detectedTech` through to step 6 agent invocations
  - Need to modify `implementUntilGreen()` function signature to accept and pass `detectedTech`
- Import the new `detectTechnology` function at the top of the file

**Dependencies**: Depends on Steps 1, 2, and 3

**Acceptance Criteria**: Contributes to AC-1, AC-2, AC-8, AC-9, AC-10

**Implementation Notes**:
- Detection happens once before step 5 and is reused for step 6 (no re-detection)
- Store `detectedTech` in a local variable scoped to the pipeline run
- Update `implementUntilGreen()` signature: add optional parameter `detectedTech?: string | null`
- Pass `detectedTech` to all `runAgentStep()` calls within `implementUntilGreen()` for step 6

---

### Step 5: Create C# Test-Writing Agent File
**File**: `agents/05-write-tests.Agents.csharp.md` (NEW)

**Changes**:
- Start with the content structure of `agents/05-write-tests.Agents.md` as a template
- Enhance with C#-specific guidance:
  - **Test Frameworks**: Mention xUnit, NUnit, MSTest with preference order (xUnit if multiple exist)
  - **Assertion Libraries**: FluentAssertions, Shouldly, or standard Assert patterns
  - **Mocking**: Moq, NSubstitute, or FakeItEasy
  - **.NET Idioms**: 
    - Test naming: PascalCase with underscores or periods (e.g., `MethodName_Scenario_ExpectedResult`)
    - Test class naming: `{ClassUnderTest}Tests` or `{ClassUnderTest}Specs`
    - Async test support (async Task test methods)
    - Theory/InlineData for parameterized tests
  - **Test Project Discovery**: Look for `.csproj` files with names containing "Test" or "Tests"
  - **Test Execution**: Document standard command formats: `dotnet test {project}.csproj` or `dotnet test`
  - **Coverage Considerations**: Mention that coverage tools like Coverlet or dotCover may be in use
- Keep the same overall structure: Inputs, Task, Outputs, Rules sections
- Maintain compatibility with the existing role specification format

**Dependencies**: None (can be done independently)

**Acceptance Criteria**: Contributes to AC-6, AC-7

**Implementation Notes**:
- File must be distinct from the generic version (not a copy)
- Should guide toward .NET best practices
- Reference official documentation patterns (Microsoft docs style)

---

### Step 6: Create TypeScript Test-Writing Agent File
**File**: `agents/05-write-tests.Agents.typescript.md` (NEW)

**Changes**:
- Start with the content structure of `agents/05-write-tests.Agents.md` as a template
- Enhance with TypeScript-specific guidance:
  - **Test Frameworks**: Jest, Vitest, Mocha, or Jasmine with preference based on what exists
  - **Assertion Libraries**: expect (Jest/Vitest), chai (Mocha), or native assertions
  - **Mocking**: jest.mock, vi.mock (Vitest), sinon, or ts-mockito
  - **TypeScript Idioms**:
    - Test naming: camelCase or descriptive strings (e.g., `it('should return user when valid ID provided')`)
    - Test file naming: `{filename}.test.ts` or `{filename}.spec.ts`
    - Type safety: Use proper types for test fixtures and mocks
    - Async/await patterns for asynchronous tests
  - **Test Discovery**: Look for `package.json` test scripts, `jest.config.*`, `vitest.config.*`, or `.spec.ts`/`.test.ts` files
  - **Test Execution**: Document standard commands: `npm test`, `npx jest`, `npx vitest run`, etc.
  - **TypeScript Considerations**: Mention that tests should compile with `tsconfig.json`, use correct module resolution
- Keep the same overall structure: Inputs, Task, Outputs, Rules sections
- Maintain compatibility with the existing role specification format

**Dependencies**: None (can be done independently)

**Acceptance Criteria**: Contributes to AC-6, AC-7

**Implementation Notes**:
- File must be distinct from the generic version
- Should guide toward modern TypeScript/JavaScript testing patterns
- Reference ecosystem best practices (Jest docs, Vitest docs)

---

### Step 7: Create C# Implementation Agent File
**File**: `agents/06-implement.Agents.csharp.md` (NEW)

**Changes**:
- Start with the content structure of `agents/06-implement.Agents.md` as a template
- Enhance with C#-specific guidance:
  - **.NET Conventions**:
    - PascalCase for public members, camelCase for private fields with underscore prefix
    - File per class/interface naming: `{TypeName}.cs`
    - Namespace organization matching folder structure
  - **Language Features**:
    - LINQ for collection operations
    - async/await for asynchronous operations
    - Nullable reference types (when enabled)
    - Pattern matching and switch expressions
    - Records for data transfer objects
  - **Dependency Injection**: Constructor injection with IServiceCollection/IServiceProvider patterns
  - **Error Handling**: Exception types, throw vs return patterns
  - **Build System**: Mention `dotnet build` and `dotnet run` commands
  - **Common Patterns**: Repository pattern, SOLID principles, extension methods
- Keep the same overall structure: Inputs, Task, Output, Rules sections
- Maintain compatibility with the existing role specification format

**Dependencies**: None (can be done independently)

**Acceptance Criteria**: Contributes to AC-6, AC-7

**Implementation Notes**:
- File must be distinct from the generic version
- Should emphasize .NET ecosystem patterns
- Mention framework-specific considerations (ASP.NET Core, Entity Framework, etc.)

---

### Step 8: Create TypeScript Implementation Agent File
**File**: `agents/06-implement.Agents.typescript.md` (NEW)

**Changes**:
- Start with the content structure of `agents/06-implement.Agents.md` as a template
- Enhance with TypeScript-specific guidance:
  - **TypeScript Idioms**:
    - camelCase for variables/functions, PascalCase for types/classes
    - Type-first development: Define interfaces/types before implementation
    - Union types and discriminated unions for state management
    - Type guards and type predicates for narrowing
  - **Language Features**:
    - Generics for reusable components
    - Utility types (Partial, Pick, Omit, etc.)
    - Optional chaining and nullish coalescing
    - Async/await with proper Promise typing
  - **Module System**: ES modules (import/export), proper module resolution
  - **Common Frameworks**: Mention patterns for Express, NestJS, React, Vue based on what exists
  - **Build & Run**: `npm run build`, `npm start`, TypeScript compiler (`tsc`) usage
  - **Type Safety**: Strict mode compliance, avoiding `any`, proper error types
- Keep the same overall structure: Inputs, Task, Output, Rules sections
- Maintain compatibility with the existing role specification format

**Dependencies**: None (can be done independently)

**Acceptance Criteria**: Contributes to AC-6, AC-7

**Implementation Notes**:
- File must be distinct from the generic version
- Should guide toward type-safe implementations
- Reference TypeScript handbook patterns

---

### Step 9: Verify Generic Agent Files Remain Unchanged
**Files**: 
- `agents/05-write-tests.Agents.md`
- `agents/06-implement.Agents.md`

**Changes**: NONE (verification step only)

**Task**: 
- Explicitly verify that the original generic agent files have not been modified
- These files must remain as the fallback for unsupported technologies

**Dependencies**: After completing Steps 5-8

**Acceptance Criteria**: Contributes to AC-7, AC-11

**Implementation Notes**:
- This is a verification checkpoint, not a code change
- Original files serve as fallback and must continue to work
- Do not modify, delete, or empty these files

---

## Testing Strategy

### Test Approach
Since the repository does not have an existing automated test suite, testing will be performed manually through end-to-end pipeline execution with representative repositories.

### Test Scenarios by Acceptance Criteria

#### AC-1: C# Detection
- **Test Repository**: Create or use a minimal C# repository containing at least one `.csproj` file
- **Verification Steps**:
  1. Run the pipeline: `npm start -- --repo <c-sharp-repo>`
  2. Check pipeline logs for: `"Detected technology: csharp"`
  3. Check step 5 logs for: `"Loading role: 05-write-tests.Agents.csharp.md"`
  4. Verify no "(fallback)" message in role loading log
- **Expected Result**: C# technology detected and C#-specific test agent file loaded

#### AC-2: TypeScript Detection
- **Test Repository**: Use this repository itself (SandcastlePipeline) or another TypeScript project with `tsconfig.json`
- **Verification Steps**:
  1. Run the pipeline: `npm start -- --repo <typescript-repo>`
  2. Check pipeline logs for: `"Detected technology: typescript"`
  3. Check step 5 logs for: `"Loading role: 05-write-tests.Agents.typescript.md"`
  4. Verify no "(fallback)" message in role loading log
- **Expected Result**: TypeScript technology detected and TypeScript-specific test agent file loaded

#### AC-3: Fallback to Generic Agent File
- **Test Repository**: Create or use a Python, Go, or Ruby repository (no C# or TypeScript)
- **Verification Steps**:
  1. Run the pipeline: `npm start -- --repo <other-repo>`
  2. Check pipeline logs for: `"Detected technology: none (using generic roles)"` or similar
  3. Check step 5 logs for: `"Loading role: 05-write-tests.Agents.md (fallback)"`
- **Expected Result**: No technology detected, generic agent files loaded with fallback notation

#### AC-4: Technology-Specific File Used for Implementation Step (C#)
- **Test Repository**: Same C# repository from AC-1 test
- **Verification Steps**:
  1. Continue pipeline execution through step 6
  2. Check step 6 logs for: `"Loading role: 06-implement.Agents.csharp.md"`
  3. Verify technology was not re-detected (only one detection log entry before step 5)
- **Expected Result**: Same C# technology used for implementation step without re-detection

#### AC-5: Technology-Specific File Used for Implementation Step (TypeScript)
- **Test Repository**: Same TypeScript repository from AC-2 test
- **Verification Steps**:
  1. Continue pipeline execution through step 6
  2. Check step 6 logs for: `"Loading role: 06-implement.Agents.typescript.md"`
  3. Verify technology was not re-detected (only one detection log entry before step 5)
- **Expected Result**: Same TypeScript technology used for implementation step without re-detection

#### AC-6: Technology-Specific Agent Files Exist with Relevant Content
- **Verification Steps**:
  1. List files in `agents/` directory: `ls -la agents/*.{csharp,typescript}.md`
  2. Verify all four files exist:
     - `05-write-tests.Agents.csharp.md`
     - `05-write-tests.Agents.typescript.md`
     - `06-implement.Agents.csharp.md`
     - `06-implement.Agents.typescript.md`
  3. Inspect each file for technology-specific content:
     - C# files: Search for "xUnit", "NUnit", "FluentAssertions", "Moq", "LINQ", ".NET"
     - TypeScript files: Search for "Jest", "Vitest", "type safety", "discriminated union"
  4. Compare tech-specific files to generic files to verify they are not identical
- **Expected Result**: All four files exist and contain meaningful, distinct technology-specific guidance

#### AC-7: Generic Agent Files Remain Unchanged
- **Verification Steps**:
  1. Before implementation: Record checksums of `agents/05-write-tests.Agents.md` and `agents/06-implement.Agents.md`
  2. After implementation: Compare checksums to verify files are unchanged
  3. Verify files still exist and are not empty
  4. Run git diff to confirm no modifications: `git diff agents/05-write-tests.Agents.md agents/06-implement.Agents.md`
- **Expected Result**: No changes to generic agent files (byte-for-byte identical)

#### AC-8: Technology Detection is Consistent Across Steps
- **Test Repository**: Any C# or TypeScript repository
- **Verification Steps**:
  1. Run complete pipeline through steps 5 and 6
  2. Parse logs to extract detection and role-loading messages
  3. Verify same technology appears in both step 5 and step 6 role loading logs
  4. Count occurrences of "Detected technology" log message (should be exactly 1)
- **Expected Result**: Technology detected once and used consistently for both steps 5 and 6

#### AC-9: Pipeline Logs Indicate Which Agent File Was Loaded
- **Test Repository**: Test with C#, TypeScript, and fallback scenarios
- **Verification Steps**:
  1. Run pipeline and capture complete log output
  2. Search logs for "Detected technology:" message (before step 5)
  3. Search logs for "Loading role:" messages (in steps 5 and 6)
  4. Verify each message clearly indicates the filename loaded
  5. Verify "(fallback)" notation when generic files are used
- **Expected Result**: Clear, unambiguous logging showing which technology was detected and which role files were loaded

#### AC-10: Mixed-Technology Repositories Handle Gracefully
- **Test Repository**: Create a repository with both `.csproj` file(s) and `tsconfig.json`
- **Verification Steps**:
  1. Run the pipeline: `npm start -- --repo <mixed-repo>`
  2. Check pipeline logs for: `"Detected technology: csharp"`
  3. Check step 5 logs for C# agent file, NOT TypeScript
  4. Verify TypeScript detection did not override C# detection
- **Expected Result**: C# takes precedence per the priority rule; C# agent files used for steps 5 and 6

#### AC-11: Backward Compatibility with Existing Pipeline Runs
- **Test Repository**: Use a repository that was successfully processed before this change
- **Verification Steps**:
  1. Ensure the repository uses a technology without specific agent files (e.g., Python)
  2. Run the complete pipeline
  3. Verify pipeline completes without errors
  4. Verify generic agent files were used (fallback behavior)
  5. Compare outputs to previous runs (should be equivalent)
- **Expected Result**: Pre-existing repositories continue to work seamlessly

#### AC-12: Code Changes are Localized to Pipeline Orchestration
- **Verification Steps**:
  1. Review git diff after implementation
  2. Verify changes are ONLY in:
     - `src/agents.ts` (new functions: `detectTechnology`, `loadRoleWithTech`)
     - `src/pipeline.ts` (detection call, passing tech to steps 5-6, signature updates)
     - `agents/` directory (4 new `.md` files)
  3. Verify NO changes to:
     - Other step agent files (02, 03, 04, 07, 08, 09, 10, 11, 12)
     - `src/config.ts`, `src/schemas.ts`, `src/report.ts`, etc.
     - `package.json`, `tsconfig.json`
  4. Count modified files: should be exactly 2 modified + 4 new = 6 total changes
- **Expected Result**: Changes are minimal and localized as specified

### Manual Testing Checklist
- [ ] Test C# repository detection and role loading
- [ ] Test TypeScript repository detection and role loading
- [ ] Test fallback behavior with unsupported technology
- [ ] Test mixed C#/TypeScript repository (C# precedence)
- [ ] Verify technology consistency across steps 5 and 6
- [ ] Verify logging output is clear and informative
- [ ] Verify generic agent files remain unchanged
- [ ] Verify backward compatibility with existing repositories
- [ ] Review code changes for localization (only affected files)
- [ ] End-to-end pipeline run with each technology type

### Test Data Requirements
- **C# Test Repository**: Minimal .NET project with at least one `.csproj` file
- **TypeScript Test Repository**: Project with `tsconfig.json` (can use SandcastlePipeline itself)
- **Mixed Repository**: Project with both `.csproj` and `tsconfig.json`
- **Fallback Repository**: Python or other language project without C# or TypeScript

---

## Definition of Done

### Feature Completion Criteria
- [ ] **Step 1-4 Complete**: All code changes in `src/agents.ts` and `src/pipeline.ts` are implemented
  - [ ] `detectTechnology()` function implemented and tested
  - [ ] `loadRoleWithTech()` function implemented and tested
  - [ ] `runAgentStep()` updated to accept `detectedTech` parameter
  - [ ] Pipeline integration: detection called before step 5, passed to steps 5-6

- [ ] **Step 5-8 Complete**: All four technology-specific agent files created
  - [ ] `agents/05-write-tests.Agents.csharp.md` created with C#-specific guidance
  - [ ] `agents/05-write-tests.Agents.typescript.md` created with TypeScript-specific guidance
  - [ ] `agents/06-implement.Agents.csharp.md` created with C#-specific guidance
  - [ ] `agents/06-implement.Agents.typescript.md` created with TypeScript-specific guidance

- [ ] **Step 9 Complete**: Generic agent files verified unchanged
  - [ ] `agents/05-write-tests.Agents.md` unchanged
  - [ ] `agents/06-implement.Agents.md` unchanged

### Acceptance Criteria Verification
- [ ] **AC-1**: C# detection works correctly (verified via manual test)
- [ ] **AC-2**: TypeScript detection works correctly (verified via manual test)
- [ ] **AC-3**: Fallback to generic files works correctly (verified via manual test)
- [ ] **AC-4**: C# implementation step uses C# agent file (verified via manual test)
- [ ] **AC-5**: TypeScript implementation step uses TypeScript agent file (verified via manual test)
- [ ] **AC-6**: All technology-specific files exist with relevant, distinct content
- [ ] **AC-7**: Generic agent files remain unchanged (verified via git diff or checksum)
- [ ] **AC-8**: Technology detection is consistent across steps 5-6 (single detection)
- [ ] **AC-9**: Logs clearly show detected technology and loaded role files
- [ ] **AC-10**: Mixed repositories handle C# precedence correctly (verified via manual test)
- [ ] **AC-11**: Backward compatibility maintained (existing repos work)
- [ ] **AC-12**: Code changes are localized (verified via git diff)

### Quality Gates
- [ ] **Code Quality**
  - [ ] TypeScript compiles without errors (`npm run build` or `npx tsx --check`)
  - [ ] No new linting errors introduced
  - [ ] Functions have appropriate error handling (try-catch where needed)
  - [ ] Logging is clear and follows existing patterns

- [ ] **Documentation**
  - [ ] Technology-specific agent files are well-structured and readable
  - [ ] Content in tech-specific files is meaningfully different from generic files
  - [ ] Code comments added where logic is non-obvious

- [ ] **Testing**
  - [ ] All 12 test scenarios from Testing Strategy executed
  - [ ] Manual testing checklist completed
  - [ ] No regressions found in existing pipeline functionality

- [ ] **Integration**
  - [ ] Pipeline builds successfully
  - [ ] Pipeline runs successfully on C# repository
  - [ ] Pipeline runs successfully on TypeScript repository
  - [ ] Pipeline runs successfully on fallback (non-C#/TypeScript) repository

### Deployment Readiness
- [ ] All code changes committed to a feature branch
- [ ] Changes reviewed for correctness and completeness
- [ ] No breaking changes to existing pipeline steps
- [ ] Ready for merge to main branch

---

## Dependencies and Ordering

### Critical Path
1. **Step 1** → **Step 2** → **Step 3** → **Step 4**: Code changes must be done in this order
   - Detection function must exist before role loading function
   - Role loading function must exist before pipeline integration
   - Pipeline changes depend on both new functions

2. **Steps 5-8**: Agent file creation can be done in parallel (no dependencies between them)
   - Can create all four files simultaneously or in any order

3. **Step 9**: Verification step runs after Steps 5-8 to confirm no unintended changes

### Parallelization Opportunities
- Steps 5, 6, 7, 8 (creating agent files) are fully independent and can be done in parallel
- Manual testing scenarios can be run in parallel after all implementation is complete

### External Dependencies
- **None**: All functionality uses existing libraries and Node.js built-ins
- **No new npm packages required**
- **No changes to deployment infrastructure**

---

## Risk Mitigation

### Technical Risks
1. **Detection Accuracy**: Technology detection might misidentify edge cases
   - *Mitigation*: Clear precedence rules (C# > TypeScript) and fallback behavior
   - *Impact*: Low - worst case uses generic files

2. **File System Operations**: Race conditions or missing files could cause errors
   - *Mitigation*: Use try-catch blocks and fallback to generic files on any error
   - *Impact*: Very low - files are in version control

3. **Backward Compatibility**: Changes might break existing pipeline runs
   - *Mitigation*: Make all new parameters optional, preserve generic file fallback
   - *Impact*: Low - thoroughly tested with fallback scenarios

### Process Risks
1. **Content Quality**: Technology-specific agent files might not be sufficiently different from generic
   - *Mitigation*: Explicit verification step (AC-6) to check for meaningful differences
   - *Impact*: Medium - affects value delivered to users

2. **Testing Coverage**: Manual testing might miss edge cases
   - *Mitigation*: Comprehensive test scenario list covering all ACs
   - *Impact*: Medium - caught through manual verification checklist

---

## Implementation Notes

### Key Design Decisions
1. **Single Detection**: Technology is detected once before step 5 and reused for step 6
   - Rationale: Avoids redundant detection, ensures consistency
   - Alternative considered: Detect separately for each step (rejected: unnecessary overhead)

2. **Precedence Rule**: C# takes priority over TypeScript in mixed repositories
   - Rationale: Backend/service code typically more central to story implementation
   - Alternative considered: Most files wins (rejected: harder to implement reliably)

3. **File Naming Convention**: `{step}.Agents.{tech}.md` pattern
   - Rationale: Clear, consistent, and easy to parse programmatically
   - Alternative considered: Directory per technology (rejected: more complex)

4. **Graceful Degradation**: Always fall back to generic files if tech-specific missing
   - Rationale: Ensures backward compatibility and robustness
   - Alternative considered: Fail pipeline (rejected: too brittle)

### Extension Points for Future Work
- **Additional Technologies**: Follow the same pattern to add Python, Go, Java, etc.
  - Add detection logic to `detectTechnology()`
  - Create four agent files for the new technology
  - No changes to pipeline orchestration required

- **More Agent Steps**: Apply technology-specific roles to other steps (4, 7, 10, etc.)
  - Use same `loadRoleWithTech()` mechanism
  - Pass `detectedTech` to additional step calls

- **Configuration Override**: Add environment variable or CLI flag for manual technology selection
  - Modify `detectTechnology()` to check for override first
  - Document override mechanism

- **Multi-Technology Support**: Handle repositories with multiple technologies more granularly
  - Detect all technologies (not just primary)
  - Select appropriate role per file being modified
  - More complex but could improve specialized guidance

---

## Summary

This implementation plan delivers a targeted enhancement to the Sandcastle Pipeline that provides specialized guidance for C# and TypeScript projects. The changes are minimal, localized, and maintain full backward compatibility with existing pipelines.

**Total files modified**: 2 (`src/agents.ts`, `src/pipeline.ts`)  
**Total files created**: 4 (technology-specific agent role files)  
**Total implementation steps**: 9 (4 code changes, 4 file creations, 1 verification)  
**External dependencies added**: 0  
**Breaking changes**: 0

The implementation follows existing patterns, uses standard Node.js APIs, and integrates seamlessly with the current pipeline architecture. All acceptance criteria are addressed through a combination of code changes, new content files, and verification steps.
