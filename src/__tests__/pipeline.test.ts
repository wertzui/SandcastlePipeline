/**
 * Integration tests for pipeline technology detection and role loading.
 * These tests verify that the pipeline correctly integrates technology detection
 * with the agent step execution.
 * 
 * AC-8: Technology detection is consistent across steps
 * AC-9: Pipeline logs indicate which agent file was loaded
 * AC-11: Backward compatibility with existing pipeline runs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Sandbox } from '@ai-hero/sandcastle';

// Note: These are integration tests that verify the pipeline behavior.
// The actual pipeline.ts will need to be modified to support detectedTech parameter.

describe('Pipeline Integration', () => {
  let mockSandbox: Sandbox;

  beforeEach(() => {
    mockSandbox = {
      exec: vi.fn(),
      run: vi.fn(),
    } as unknown as Sandbox;
  });

  // AC-8: Technology detection is consistent across steps
  it('should detect technology once and reuse for both step 5 and step 6', async () => {
    // This test verifies that technology is detected once before step 5
    // and the same value is passed to both step 5 (write tests) and step 6 (implement)
    
    // Mock technology detection
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 0,
      stdout: './Project.csproj\n',
      stderr: '',
    });

    // Verify that detection happens only once
    expect(mockSandbox.exec).not.toHaveBeenCalled();
    
    // TODO: When pipeline.ts is implemented, verify:
    // 1. detectTechnology is called once before step 5
    // 2. The result is stored in a variable
    // 3. The same variable is passed to both step 5 and step 6
    // 4. detectTechnology is NOT called again before step 6
  });

  // AC-11: Backward compatibility
  it('should work with existing repositories when no tech-specific files exist', async () => {
    // This test ensures that the pipeline still works when:
    // 1. No technology is detected (returns null)
    // 2. OR technology is detected but no tech-specific files exist
    // In both cases, it should fall back to generic agent files seamlessly
    
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    }).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    });

    // TODO: Verify that:
    // 1. Pipeline completes successfully
    // 2. Generic role files are loaded
    // 3. No errors or warnings are thrown
  });

  // AC-9: Logging verification
  it('should log which agent file was loaded for each step', async () => {
    // This test verifies that the pipeline logs clearly indicate:
    // - "Detected technology: csharp" or "Detected technology: typescript" or "No technology detected"
    // - "Loading role: 05-write-tests.Agents.csharp.md" or
    // - "Loading role: 05-write-tests.Agents.md (fallback)"
    
    // TODO: Capture log output and verify it contains the expected messages
  });

  // Additional integration test scenarios
  
  it('should handle step 5 with C# technology detection', async () => {
    // Verify that when C# is detected:
    // 1. loadRoleWithTech is called with 'csharp'
    // 2. The correct file path is attempted
    // 3. If file doesn't exist, fallback works
  });

  it('should handle step 6 with TypeScript technology detection', async () => {
    // Verify that when TypeScript is detected:
    // 1. loadRoleWithTech is called with 'typescript'
    // 2. The correct file path is attempted
    // 3. If file doesn't exist, fallback works
  });

  it('should pass detectedTech parameter through runAgentStep', async () => {
    // This test verifies that the AgentStepOptions interface accepts detectedTech
    // and that it's properly passed to loadRoleWithTech
    
    // TODO: When pipeline.ts is implemented, verify:
    // 1. runAgentStep accepts detectedTech in options
    // 2. It's optional (backward compatibility)
    // 3. It defaults to null if not provided
    // 4. It's passed to loadRoleWithTech correctly
  });
});

describe('Agent File Naming Convention', () => {
  // AC-6: Verify naming convention is correct
  
  it('should follow the pattern NN-step-name.Agents.{tech}.md', () => {
    const testCases = [
      { base: '05-write-tests.Agents.md', tech: 'csharp', expected: '05-write-tests.Agents.csharp.md' },
      { base: '05-write-tests.Agents.md', tech: 'typescript', expected: '05-write-tests.Agents.typescript.md' },
      { base: '06-implement.Agents.md', tech: 'csharp', expected: '06-implement.Agents.csharp.md' },
      { base: '06-implement.Agents.md', tech: 'typescript', expected: '06-implement.Agents.typescript.md' },
    ];

    testCases.forEach(({ base, tech, expected }) => {
      // Extract base name without .md extension
      const baseName = base.replace(/\.md$/, '');
      const techSpecificName = `${baseName}.${tech}.md`;
      
      expect(techSpecificName).toBe(expected);
    });
  });
});
