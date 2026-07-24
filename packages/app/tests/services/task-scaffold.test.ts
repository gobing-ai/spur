import { describe, expect, test } from 'bun:test';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { TaskScaffoldService } from '../../src/services/task-scaffold';

class MockFileSystem implements FileSystem {
    files = new Map<string, string>();
    dirs = new Set<string>();

    async readFile(path: string): Promise<string> {
        const content = this.files.get(path);
        if (content === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return content;
    }

    async writeFile(path: string, content: string): Promise<void> {
        this.files.set(path, content);
    }

    async exists(path: string): Promise<boolean> {
        return this.files.has(path) || this.dirs.has(path);
    }

    async mkdir(path: string): Promise<void> {
        this.dirs.add(path);
    }

    async readDir(dir: string): Promise<string[]> {
        const results: string[] = [];
        const prefix = dir.endsWith('/') ? dir : `${dir}/`;
        for (const k of this.files.keys()) {
            if (k.startsWith(prefix)) {
                const sub = k.substring(prefix.length);
                const firstSlash = sub.indexOf('/');
                const name = firstSlash === -1 ? sub : sub.substring(0, firstSlash);
                if (!results.includes(name)) {
                    results.push(name);
                }
            }
        }
        return results;
    }

    resolve(...paths: string[]): string {
        return paths.join('/').replace(/\/+/g, '/');
    }

    dirname(path: string): string {
        const idx = path.lastIndexOf('/');
        return idx === -1 ? '.' : path.substring(0, idx);
    }

    async appendFile(): Promise<void> {}
    async ensureDir(): Promise<void> {}
    async deleteFile(): Promise<void> {}
    async copy(): Promise<void> {}
    async move(): Promise<void> {}
    async realpath(p: string): Promise<string> {
        return p;
    }
    createWriteStream(): never {
        throw new Error('Not implemented');
    }
    getProjectRoot(): string {
        return '/workspace';
    }

    stat(): never {
        throw new Error('Not implemented');
    }
    statSync(): never {
        throw new Error('Not implemented');
    }
    readFileSync(): never {
        throw new Error('Not implemented');
    }
    writeFileSync(): never {
        throw new Error('Not implemented');
    }
    existsSync(): never {
        throw new Error('Not implemented');
    }
    unlink(): never {
        throw new Error('Not implemented');
    }
    rmdir(): never {
        throw new Error('Not implemented');
    }
    copyFile(): never {
        throw new Error('Not implemented');
    }
    rename(): never {
        throw new Error('Not implemented');
    }
}

describe('TaskScaffoldService (0320)', () => {
    test('R1, R2, R5: scaffolds test.todo stubs for task AC scenarios', async () => {
        const fs = new MockFileSystem();
        const taskPath = '/workspace/docs/tasks/0320_scaffold.md';
        const taskContent = `---
name: "Scaffold BDD test stubs"
status: todo
---

## Acceptance Criteria

\`\`\`gherkin
Feature: Scaffold BDD test stubs

  Scenario: First scaffold scenario
    Given task AC with scenario
    When generator runs
    Then stub is written

  Scenario: Second scaffold scenario
    Given another scenario
    When generator runs
    Then second stub is written
\`\`\`
`;
        await fs.writeFile(taskPath, taskContent);

        const svc = new TaskScaffoldService({
            fs,
            tasksDir: '/workspace/docs/tasks',
        });

        const result = await svc.scaffoldTests('0320', {
            targetFile: '/workspace/tests/tasks/0320.test.ts',
        });

        expect(result.created).toBe(2);
        expect(result.skipped).toBe(0);
        expect(result.drifted).toBe(0);

        const testContent = await fs.readFile('/workspace/tests/tasks/0320.test.ts');
        expect(testContent).toContain("import { test } from 'bun:test';");
        expect(testContent).toContain('// @ac:first scaffold scenario');
        expect(testContent).toContain("test.todo('First scaffold scenario', () => {");
        expect(testContent).toContain('// @ac:second scaffold scenario');
        expect(testContent).toContain("test.todo('Second scaffold scenario', () => {");
    });

    test('R3 & R5: preserves filled stub bodies, appends new scenarios, flags drift', async () => {
        const fs = new MockFileSystem();
        const taskPath = '/workspace/docs/tasks/0320_scaffold.md';
        const taskContent = `---
name: "Updated task AC"
status: todo
---

## Acceptance Criteria

\`\`\`gherkin
Feature: Updated task AC

  Scenario: Preserved scenario
    Given existing scenario

  Scenario: Newly added scenario
    Given new scenario
\`\`\`
`;
        await fs.writeFile(taskPath, taskContent);

        const existingTestFile = `/workspace/tests/tasks/0320.test.ts`;
        const existingTestContent = `import { test } from 'bun:test';

// @ac:preserved scenario
test('Preserved scenario', () => {
    // Custom filled test logic
    expect(true).toBe(true);
});

// @ac:removed old scenario
test.todo('Removed old scenario', () => {
    // Given old scenario
});
`;
        await fs.writeFile(existingTestFile, existingTestContent);

        const svc = new TaskScaffoldService({
            fs,
            tasksDir: '/workspace/docs/tasks',
        });

        const result = await svc.scaffoldTests('0320', {
            targetFile: existingTestFile,
        });

        expect(result.created).toBe(1); // 'Newly added scenario' appended
        expect(result.skipped).toBe(1); // 'Preserved scenario' skipped
        expect(result.drifted).toBe(1); // 'removed old scenario' flagged as drift
        expect(result.driftedScenarios).toEqual(['removed old scenario']);
        expect(result.warnings).toHaveLength(1);

        const updatedTestContent = await fs.readFile(existingTestFile);
        expect(updatedTestContent).toContain("test('Preserved scenario', () => {");
        expect(updatedTestContent).toContain('// Custom filled test logic');
        expect(updatedTestContent).toContain("test.todo('Newly added scenario'");
        expect(updatedTestContent).toContain("test.todo('Removed old scenario'");
    });

    test('R4: expands Scenario Outline example rows', async () => {
        const fs = new MockFileSystem();
        const taskPath = '/workspace/docs/tasks/0320_scaffold.md';
        const taskContent = `---
name: "Outline task"
status: todo
---

## Acceptance Criteria

\`\`\`gherkin
Feature: Outline expansion

  Scenario Outline: Process <item>
    Given item <item>
    When processed
    Then result is <result>

    Examples:
      | item | result |
      | A    | pass   |
      | B    | fail   |
\`\`\`
`;
        await fs.writeFile(taskPath, taskContent);

        const svc = new TaskScaffoldService({
            fs,
            tasksDir: '/workspace/docs/tasks',
        });

        const result = await svc.scaffoldTests('0320', {
            targetFile: '/workspace/tests/tasks/0320.test.ts',
        });

        expect(result.created).toBe(2);
        const testContent = await fs.readFile('/workspace/tests/tasks/0320.test.ts');
        expect(testContent).toContain("test.todo('Process <item> (Example 1: item=A, result=pass)', () => {");
        expect(testContent).toContain("test.todo('Process <item> (Example 2: item=B, result=fail)', () => {");
    });
});
