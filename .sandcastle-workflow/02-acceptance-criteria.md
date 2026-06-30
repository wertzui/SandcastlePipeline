# Acceptance Criteria

## Refined Description
**As a** user of the Sandcastle Pipeline workflow,  
**I want** the test-writing (step 5) and implementation (step 6) agents to automatically load technology-specific role files based on the detected technology stack,  
**so that** I get better, more specialized guidance and higher-quality outputs when working with C# or TypeScript projects.

---

## Scope

### In Scope
- Automatic detection of the primary technology/language used in the target repository (C# and TypeScript as initial supported technologies)
- Loading of technology-specific agent role files for the test-writing step (step 5)
- Loading of technology-specific agent role files for the implementation step (step 6)
- Creation of initial technology-specific agent files:
  - `agents/05-write-tests.Agents.csharp.md` for C# test writing
  - `agents/05-write-tests.Agents.typescript.md` for TypeScript test writing
  - `agents/06-implement.Agents.csharp.md` for C# implementation
  - `agents/06-implement.Agents.typescript.md` for TypeScript implementation
- Fallback to the existing generic `.Agents.md` files when no technology-specific file exists
- Pipeline logic to detect technology and select the appropriate role file

### Out of Scope
- Other pipeline steps (refinement, planning, review, etc.) — only steps 5 and 6 are affected
- Technologies beyond C# and TypeScript in this iteration
- Multi-language projects (the pipeline will detect and use the primary/dominant technology)
- User-configurable technology detection or manual technology selection
- Runtime switching of technology during a pipeline run

---

## Assumptions
1. **Technology detection heuristics**: The pipeline will detect C# by the presence of `.csproj` files and TypeScript by the presence of `tsconfig.json` or a majority of `.ts` files in the source tree. If both are present, C# takes precedence as the primary technology.
2. **Naming convention**: Technology-specific agent files follow the pattern `NN-step-name.Agents.<tech>.md` (e.g., `05-write-tests.Agents.csharp.md`, `06-implement.Agents.typescript.md`).
3. **Backward compatibility**: Existing generic `05-write-tests.Agents.md` and `06-implement.Agents.md` remain as fallbacks and must not be deleted.
4. **Content differentiation**: Technology-specific role files will include framework-specific best practices, idioms, and tooling guidance (e.g., xUnit/NUnit patterns for C#, Jest/Vitest patterns for TypeScript).
5. **Single detection per run**: The technology is detected once at the beginning of the pipeline (before or during step 5) and used for both step 5 and step 6.

---

## Open Questions
- **Q**: Should the technology detection be cached/stored in an artifact file (e.g., `.sandcastle-workflow/detected-tech.txt`) or determined on-the-fly each time a step runs?  
  **Default assumption**: Detection happens once early in the pipeline (before step 5) and the result is passed to both step 5 and step 6 through the existing `runAgentStep` mechanism, avoiding repeated detection.

- **Q**: If a repository has both C# and TypeScript, which should take precedence?  
  **Default assumption**: C# takes precedence when both are present, as backend/service code is typically more central to the story implementation than frontend code in mixed-stack repositories.

- **Q**: What happens if the Improve agent (step 10) needs to edit technology-specific files?  
  **Default assumption**: The Improve agent will be given visibility into all `.Agents.md` files (including technology-specific variants) and can edit them. The improved step-10 role will document which files exist and when to improve them.

---

## Acceptance Criteria

**AC-1**: Technology detection for C#  
**Given** a target repository containing one or more `.csproj` files,  
**When** the pipeline runs the test-writing step (step 5),  
**Then** the pipeline detects the technology as `csharp` and loads `agents/05-write-tests.Agents.csharp.md` instead of the generic `agents/05-write-tests.Agents.md`.

**AC-2**: Technology detection for TypeScript  
**Given** a target repository containing a `tsconfig.json` file or where `.ts` files outnumber other source files,  
**When** the pipeline runs the test-writing step (step 5),  
**Then** the pipeline detects the technology as `typescript` and loads `agents/05-write-tests.Agents.typescript.md` instead of the generic `agents/05-write-tests.Agents.md`.

**AC-3**: Fallback to generic agent file  
**Given** a target repository using a technology for which no specific agent file exists (e.g., Python, Go),  
**When** the pipeline runs the test-writing step (step 5),  
**Then** the pipeline falls back to loading the generic `agents/05-write-tests.Agents.md` file.

**AC-4**: Technology-specific file used for implementation step  
**Given** the technology was detected as `csharp` during step 5,  
**When** the pipeline runs the implementation step (step 6),  
**Then** the pipeline loads `agents/06-implement.Agents.csharp.md` instead of the generic `agents/06-implement.Agents.md`.

**AC-5**: Technology-specific file used for implementation step (TypeScript)  
**Given** the technology was detected as `typescript` during step 5,  
**When** the pipeline runs the implementation step (step 6),  
**Then** the pipeline loads `agents/06-implement.Agents.typescript.md` instead of the generic `agents/06-implement.Agents.md`.

**AC-6**: Technology-specific agent files exist with relevant content  
**Given** the initial implementation is complete,  
**When** inspecting the `agents/` directory,  
**Then** the following files exist and contain meaningful, technology-specific guidance (not just copies of the generic files):
- `agents/05-write-tests.Agents.csharp.md` (references xUnit/NUnit/MSTest, FluentAssertions, Moq, .NET idioms)
- `agents/05-write-tests.Agents.typescript.md` (references Jest/Vitest, common TypeScript testing patterns)
- `agents/06-implement.Agents.csharp.md` (references .NET conventions, LINQ, async/await patterns, dependency injection)
- `agents/06-implement.Agents.typescript.md` (references TypeScript idioms, type safety, common frameworks)

**AC-7**: Generic agent files remain unchanged  
**Given** the initial implementation is complete,  
**When** inspecting the `agents/` directory,  
**Then** the original `agents/05-write-tests.Agents.md` and `agents/06-implement.Agents.md` files still exist and have not been deleted or emptied.

**AC-8**: Technology detection is consistent across steps  
**Given** the technology was detected as `csharp` during step 5,  
**When** the pipeline reaches step 6,  
**Then** the same technology (`csharp`) is used for step 6 without re-detection, ensuring consistency.

**AC-9**: Pipeline logs indicate which agent file was loaded  
**Given** the pipeline is running step 5 or step 6,  
**When** viewing the pipeline logs or console output,  
**Then** the log clearly indicates which agent role file was loaded (e.g., "Loading role: 05-write-tests.Agents.csharp.md" or "Loading role: 06-implement.Agents.md (fallback)").

**AC-10**: Mixed-technology repositories handle gracefully  
**Given** a target repository containing both `.csproj` files and a `tsconfig.json`,  
**When** the pipeline runs,  
**Then** the pipeline detects C# as the primary technology (precedence rule) and uses the C#-specific agent files for steps 5 and 6.

**AC-11**: Backward compatibility with existing pipeline runs  
**Given** an existing Sandcastle Pipeline installation,  
**When** the new technology-detection feature is deployed,  
**Then** repositories that previously worked continue to work without errors, using either the new technology-specific files (if applicable) or falling back to the generic files seamlessly.

**AC-12**: Code changes are localized to pipeline orchestration  
**Given** the implementation is complete,  
**When** reviewing the code changes,  
**Then** changes are primarily in `src/pipeline.ts` (orchestration logic), `src/agents.ts` (role loading), and the new agent role files in `agents/`, with no changes to the Sandcastle framework itself or to steps 2, 3, 4, 7, 8, 9, 10, 11, or 12.
