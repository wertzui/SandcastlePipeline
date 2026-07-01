/**
 * Tests for technology detection and tech-specific role loading.
 * Written in TDD style - tests will fail until implementation is complete.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Sandbox } from '@ai-hero/sandcastle';
import { detectTechnology, loadRoleWithTech } from '../agents.js';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

// Mock filesystem functions
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('detectTechnology', () => {
  let mockSandbox: Sandbox;

  beforeEach(() => {
    mockSandbox = {
      exec: vi.fn(),
    } as unknown as Sandbox;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // AC-1: Technology detection for C#
  it('should detect csharp when .csproj files exist', async () => {
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 0,
      stdout: './MyProject.csproj\n',
      stderr: '',
    });

    const result = await detectTechnology(mockSandbox);

    expect(result).toBe('csharp');
    expect(mockSandbox.exec).toHaveBeenCalledWith(
      expect.stringContaining('*.csproj')
    );
  });

  // AC-2: Technology detection for TypeScript
  it('should detect typescript when tsconfig.json exists', async () => {
    // First check for C# - not found
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    });
    // Then check for TypeScript - found
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 0,
      stdout: './tsconfig.json\n',
      stderr: '',
    });

    const result = await detectTechnology(mockSandbox);

    expect(result).toBe('typescript');
    expect(mockSandbox.exec).toHaveBeenCalledTimes(2);
  });

  // AC-3: Fallback to generic when no technology detected
  it('should return null when no specific technology is detected', async () => {
    // Check for C# - not found
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    });
    // Check for TypeScript - not found
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
    });

    const result = await detectTechnology(mockSandbox);

    expect(result).toBeNull();
  });

  // AC-10: C# takes precedence in mixed repositories
  it('should prioritize csharp over typescript when both exist', async () => {
    // C# check - found
    vi.mocked(mockSandbox.exec).mockResolvedValueOnce({
      exitCode: 0,
      stdout: './Project.csproj\n',
      stderr: '',
    });

    const result = await detectTechnology(mockSandbox);

    expect(result).toBe('csharp');
    // Should not check for TypeScript since C# was found
    expect(mockSandbox.exec).toHaveBeenCalledTimes(1);
  });

  it('should handle errors gracefully and return null', async () => {
    vi.mocked(mockSandbox.exec).mockRejectedValueOnce(new Error('Command failed'));

    const result = await detectTechnology(mockSandbox);

    expect(result).toBeNull();
  });
});

describe('loadRoleWithTech', () => {
  const MOCK_GENERIC_CONTENT = '# Generic role content';
  const MOCK_CSHARP_CONTENT = '# C# specific role content';
  const MOCK_TYPESCRIPT_CONTENT = '# TypeScript specific role content';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // AC-3: Fallback to generic agent file
  it('should load generic role file when tech is null', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(MOCK_GENERIC_CONTENT);

    const result = await loadRoleWithTech('05-write-tests.Agents.md', null);

    expect(result).toBe(MOCK_GENERIC_CONTENT);
    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('05-write-tests.Agents.md'),
      'utf8'
    );
  });

  // AC-4: Technology-specific file used for C#
  it('should load csharp-specific role file when it exists', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValueOnce(MOCK_CSHARP_CONTENT);

    const result = await loadRoleWithTech('05-write-tests.Agents.md', 'csharp');

    expect(result).toBe(MOCK_CSHARP_CONTENT);
    expect(existsSync).toHaveBeenCalledWith(
      expect.stringContaining('05-write-tests.Agents.csharp.md')
    );
    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('05-write-tests.Agents.csharp.md'),
      'utf8'
    );
  });

  // AC-5: Technology-specific file used for TypeScript
  it('should load typescript-specific role file when it exists', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValueOnce(MOCK_TYPESCRIPT_CONTENT);

    const result = await loadRoleWithTech('06-implement.Agents.md', 'typescript');

    expect(result).toBe(MOCK_TYPESCRIPT_CONTENT);
    expect(existsSync).toHaveBeenCalledWith(
      expect.stringContaining('06-implement.Agents.typescript.md')
    );
  });

  // AC-3: Fallback when tech-specific file doesn't exist
  it('should fallback to generic file when tech-specific file does not exist', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(readFile).mockResolvedValueOnce(MOCK_GENERIC_CONTENT);

    const result = await loadRoleWithTech('05-write-tests.Agents.md', 'csharp');

    expect(result).toBe(MOCK_GENERIC_CONTENT);
    expect(existsSync).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining('05-write-tests.Agents.md'),
      'utf8'
    );
  });

  it('should handle file read errors by falling back to generic', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('File read failed'))
      .mockResolvedValueOnce(MOCK_GENERIC_CONTENT);

    const result = await loadRoleWithTech('05-write-tests.Agents.md', 'csharp');

    expect(result).toBe(MOCK_GENERIC_CONTENT);
  });

  // Test for proper filename construction
  it('should construct correct tech-specific filename', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValueOnce('content');

    await loadRoleWithTech('05-write-tests.Agents.md', 'csharp');

    expect(existsSync).toHaveBeenCalledWith(
      expect.stringMatching(/05-write-tests\.Agents\.csharp\.md$/)
    );
  });

  it('should handle different base filenames correctly', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(true);
    vi.mocked(readFile).mockResolvedValueOnce('content');

    await loadRoleWithTech('06-implement.Agents.md', 'typescript');

    expect(existsSync).toHaveBeenCalledWith(
      expect.stringMatching(/06-implement\.Agents\.typescript\.md$/)
    );
  });
});
