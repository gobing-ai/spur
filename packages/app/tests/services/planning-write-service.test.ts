import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    assertNoNewPhantomSections,
    CapturingEmitter,
    type EntityRef,
    type LifecyclePort,
    NoopEventEmitter,
    PlanningWriteService,
    phantomSections,
    SchemaLifecyclePort,
    type TransitionResult,
} from '../../src/services/planning-write-service';

// ─── Test fixtures ──────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spur-write-service-'));
});

afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
});

function makeFs() {
    return createNodeFileSystem(tempDir);
}

/** Valid task file content with canonical sections. */
function makeTaskContent(status = 'backlog'): string {
    return [
        '---',
        'schema_version: 1',
        'name: "Test task"',
        `status: ${status}`,
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        '## 0042. Test task',
        '',
        '### Background',
        '',
        'Test background.',
        '',
        '### Plan',
        '',
        '',
        '### Solution',
        '',
        '',
        '### Review',
        '',
        '',
        '### Testing',
        '',
        '',
        '### History',
        '',
        '',
    ].join('\n');
}
function makeFeatureContent(status = 'backlog'): string {
    return [
        '---',
        'schema_version: 1',
        'id: A',
        'name: "Test feature"',
        `status: ${status}`,
        'priority: P1',
        'created_at: 2026-06-13T00:00:00.000Z',
        'updated_at: 2026-06-13T00:00:00.000Z',
        '---',
        '',
        '# A: Test feature',
        '',
        '## Goal',
        '',
        'Goal here.',
        '',
        '## Scope',
        '',
        '',
        '## Acceptance Criteria',
        '',
        '',
        '## Notes',
        '',
        '',
        '## History',
        '',
        '',
    ].join('\n');
}

function makeTaskRef(): EntityRef {
    return {
        kind: 'task',
        id: '0042',
        filePath: join(tempDir, '0042_test_task.md'),
        folder: tempDir,
    };
}

function makeFeatureRef(): EntityRef {
    return {
        kind: 'feature',
        id: 'A',
        filePath: join(tempDir, 'A_test_feature.md'),
        folder: tempDir,
    };
}

/** Read the file from disk after a write, returning the raw content. */
async function readBack(ref: EntityRef): Promise<string> {
    return await makeFs().readFile(ref.filePath);
}

/** A lifecycle port that denies all transitions except when allowTo is set. */
class DenyingLifecyclePort implements LifecyclePort {
    allowTo: string | null = null;
    requestTransition(_ref: EntityRef, currentStatus: string, to: string): TransitionResult {
        if (to === this.allowTo) {
            return { allowed: true, from: currentStatus, to };
        }
        return { allowed: false, from: currentStatus, to, report: `denied: ${to}` };
    }
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('PlanningWriteService', () => {
    describe('create', () => {
        test('writes a new task file with frontmatter + body intact', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            const content = makeTaskContent();

            const result = await svc.create(ref, content);

            expect(result.eventName).toBe('task.created');
            expect(result.fromStatus).toBeUndefined();
            const written = await readBack(ref);
            expect(written).toContain('Test task');
            expect(written).toContain('## 0042. Test task');
        });

        test('sets updated_at as single writer', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();

            await svc.create(ref, makeTaskContent());

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            const updated = doc.frontmatterData?.updated_at as string | undefined;
            expect(updated).toBeDefined();
            // updated_at should be a valid ISO date
            expect(Number.isNaN(Date.parse(updated as string))).toBe(false);
        });

        test('acquires the create-lock during file creation', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();

            await svc.create(ref, makeTaskContent());

            // Lock should be released after the write completes
            const lockPath = join(tempDir, '.create.lock');
            expect(fs.exists(lockPath)).toBe(false);
        });

        test('emits feature.created event for feature domain', async () => {
            const fs = makeFs();
            const events: { event: string }[] = [];
            const emitter = {
                emit: (e: { event: string }) => {
                    events.push(e);
                },
            };
            const svc = new PlanningWriteService({ fs, emitter });
            const ref = makeFeatureRef();

            const result = await svc.create(ref, makeFeatureContent());

            expect(result.eventName).toBe('feature.created');
            expect(events).toHaveLength(1);
            expect(events[0]?.event).toBe('feature.created');
        });
    });

    describe('updateSection', () => {
        test('replaces the body of a named section', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            await svc.updateSection(ref, 'Solution', 'New solution body.\n');

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            expect(doc.getSection('Solution')).toContain('New solution body');
        });

        test('emits task.updated event (non-status change)', async () => {
            const fs = makeFs();
            const events: { event: string }[] = [];
            const emitter = {
                emit: (e: { event: string }) => {
                    events.push(e);
                },
            };
            const svc = new PlanningWriteService({ fs, emitter });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const result = await svc.updateSection(ref, 'Solution', 'Updated.\n');

            expect(result.eventName).toBe('task.updated');
            expect(events[0]?.event).toBe('task.updated');
        });

        test('updates updated_at timestamp', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            await svc.updateSection(ref, 'Solution', 'body\n');

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            const updated = doc.frontmatterData?.updated_at as string;
            // Should differ from the original 2026-06-13 baseline
            expect(updated).not.toBe('2026-06-13T00:00:00.000Z');
        });
    });

    describe('phantom-section guard (R3)', () => {
        // A task file that already carries a non-canonical section on disk
        // (`### Bogus Phantom`) — simulates corruption from a PRIOR write.
        function makeTaskContentWithPhantom(): string {
            return makeTaskContent().replace(
                '### Solution\n',
                '### Bogus Phantom\n\nLeaked content.\n\n### Solution\n',
            );
        }

        test('guard aborts on a NEW phantom but tolerates a pre-existing one (unit)', () => {
            // Pre-existing phantom in `before` → tolerated (no throw).
            const docPre = MarkdownDocument.parse(makeTaskContentWithPhantom(), 'task');
            const beforePre = new Set(phantomSections(docPre, 'task'));
            expect(beforePre.has('Bogus Phantom')).toBe(true);
            expect(() => assertNoNewPhantomSections(docPre, 'task', beforePre)).not.toThrow();

            // A phantom NOT in `before` → rejected. Start from a clean baseline,
            // then parse a corrupted doc whose phantom was absent before.
            const cleanBefore = new Set(phantomSections(MarkdownDocument.parse(makeTaskContent(), 'task'), 'task'));
            expect(cleanBefore.size).toBe(0);
            expect(() => assertNoNewPhantomSections(docPre, 'task', cleanBefore)).toThrow(/non-canonical section/);
        });

        test('does NOT abort a mutation on a file with a PRE-EXISTING phantom (stays editable)', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContentWithPhantom());

            // A prior agent already corrupted the file; an unrelated edit must still
            // succeed — `spur task check` is what surfaces the phantom for cleanup,
            // not the write guard. (Regression: R3 used to block ~15 corpus tasks.)
            const result = await svc.updateFrontmatter(ref, 'priority', 'P1');
            expect(result.eventName).toBe('task.updated');
            const after = await readBack(ref);
            expect(after).toContain('priority: P1');
            // The pre-existing phantom is preserved (untouched), not silently dropped.
            expect(after).toContain('### Bogus Phantom');
        });

        test('does NOT abort a valid section update', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const result = await svc.updateSection(ref, 'Solution', 'Clean body.\n');
            expect(result.eventName).toBe('task.updated');
        });

        test('does NOT abort for record-function bodies (**bold** + tables)', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const recordBody = '**Verdict:** PASS\n\n| Requirement | Status |\n|---|---|\n| R1 | pass |\n';
            const result = await svc.updateSection(ref, 'Testing', recordBody);
            expect(result.eventName).toBe('task.updated');
            const written = await readBack(ref);
            expect(written).toContain('**Verdict:** PASS');
        });

        test('strips a same-level heading from a section body before the guard runs (R2+R3)', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            // R2 strips the `### Phantom` line so R3 never sees a phantom section.
            const result = await svc.updateSection(ref, 'Solution', 'Body.\n### Phantom\nMore.\n');
            expect(result.eventName).toBe('task.updated');
            const doc = MarkdownDocument.parse(await readBack(ref), 'task');
            expect(doc.sectionNames).not.toContain('Phantom');
        });

        test('surfaces stripped headings as result.warnings (output-seam path, no console)', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const result = await svc.updateSection(ref, 'Solution', 'Body.\n### Phantom\nMore.\n');
            expect(result.warnings).toHaveLength(1);
            expect(result.warnings?.[0]).toContain('### Phantom');
        });

        test('omits warnings when nothing was stripped', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const result = await svc.updateSection(ref, 'Solution', 'Clean body.\n');
            expect(result.warnings).toBeUndefined();
        });
    });

    describe('updateFrontmatter', () => {
        test('sets a scalar frontmatter field', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            await svc.updateFrontmatter(ref, 'priority', 'P1');

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            expect(doc.frontmatterData?.priority).toBe('P1');
        });

        test('does NOT emit transition event for non-status field', async () => {
            const fs = makeFs();
            const events: { event: string }[] = [];
            const emitter = {
                emit: (e: { event: string }) => {
                    events.push(e);
                },
            };
            const svc = new PlanningWriteService({ fs, emitter });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            const result = await svc.updateFrontmatter(ref, 'priority', 'P1');

            expect(result.eventName).toBe('task.updated');
            expect(events[0]?.event).toBe('task.updated');
        });
    });

    describe('transition', () => {
        test('changes status and emits task.transitioned event', async () => {
            const fs = makeFs();
            const events: { event: string }[] = [];
            const emitter = {
                emit: (e: { event: string }) => {
                    events.push(e);
                },
            };
            const svc = new PlanningWriteService({ fs, emitter });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('backlog'));

            const result = await svc.transition(ref, 'todo');

            expect(result.eventName).toBe('task.transitioned');
            expect(result.fromStatus).toBe('backlog');
            expect(result.toStatus).toBe('todo');
            expect(events[0]?.event).toBe('task.transitioned');
        });

        test('appends a History line with timestamp, from→to, actor', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('backlog'));

            await svc.transition(ref, 'todo', 'operator');

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            const history = doc.getSection('History') ?? '';
            expect(history).toContain('backlog → todo');
            expect(history).toContain('(operator)');
        });

        test('aborts with zero partial writes on guard denial (R3)', async () => {
            const fs = makeFs();
            const denyingPort = new DenyingLifecyclePort();
            denyingPort.allowTo = null; // deny everything
            const svc = new PlanningWriteService({ fs, lifecycle: denyingPort });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('backlog'));

            // Capture the original content to prove byte-identical on abort
            const original = await readBack(ref);

            await expect(svc.transition(ref, 'todo')).rejects.toThrow(/Lifecycle transition denied/);

            // File must be byte-identical — zero partial writes (R3)
            const after = await readBack(ref);
            expect(after).toBe(original);
        });

        test('allows transition when guard permits', async () => {
            const fs = makeFs();
            const denyingPort = new DenyingLifecyclePort();
            denyingPort.allowTo = 'todo';
            const svc = new PlanningWriteService({ fs, lifecycle: denyingPort });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('backlog'));

            const result = await svc.transition(ref, 'todo');

            expect(result.toStatus).toBe('todo');
            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            expect(doc.frontmatterData?.status).toBe('todo');
        });

        test('emits feature.transitioned for feature domain', async () => {
            const fs = makeFs();
            const events: { event: string }[] = [];
            const emitter = {
                emit: (e: { event: string }) => {
                    events.push(e);
                },
            };
            const svc = new PlanningWriteService({ fs, emitter });
            const ref = makeFeatureRef();
            await fs.writeFile(ref.filePath, makeFeatureContent('backlog'));

            const result = await svc.transition(ref, 'active');

            expect(result.eventName).toBe('feature.transitioned');
            expect(events[0]?.event).toBe('feature.transitioned');
        });

        test('default SchemaLifecyclePort allows any different status', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('todo'));

            const result = await svc.transition(ref, 'wip');

            expect(result.toStatus).toBe('wip');
        });

        test('normalizes legacy PascalCase status before lifecycle transition (task 0152)', async () => {
            const fs = makeFs();
            // A capturing spy that records what the lifecycle port actually receives.
            const seen: { current: string; to: string }[] = [];
            const port: LifecyclePort = {
                requestTransition(_ref, currentStatus, to) {
                    seen.push({ current: currentStatus, to });
                    return { allowed: true, from: currentStatus, to };
                },
            };
            const svc = new PlanningWriteService({ fs, lifecycle: port });
            const ref = makeTaskRef();
            // Seed a file with a legacy PascalCase status (old rd3 corpus shape).
            await fs.writeFile(ref.filePath, makeTaskContent('Backlog' as string));

            const result = await svc.transition(ref, 'todo');

            // The engine must receive canonical lowercase — never raw "Backlog".
            expect(seen[0]?.current).toBe('backlog');
            expect(seen[0]?.to).toBe('todo');
            expect(result.fromStatus).toBe('backlog');
            expect(result.toStatus).toBe('todo');
        });

        test('does not double-write updated_at — single writer (R2)', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('todo'));

            await svc.transition(ref, 'wip');

            const written = await readBack(ref);
            // Count occurrences of updated_at in frontmatter — should be exactly 1
            const matches = written.match(/^updated_at:/gm);
            expect(matches).toHaveLength(1);
        });
    });

    describe('lock release', () => {
        test('releases entity lock after successful write', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            await svc.updateSection(ref, 'Solution', 'body\n');

            const lockPath = join(tempDir, '.0042.lock');
            expect(fs.exists(lockPath)).toBe(false);
        });

        test('releases entity lock even when guard denies', async () => {
            const fs = makeFs();
            const denyingPort = new DenyingLifecyclePort();
            const svc = new PlanningWriteService({ fs, lifecycle: denyingPort });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent());

            await expect(svc.transition(ref, 'todo')).rejects.toThrow();

            const lockPath = join(tempDir, '.0042.lock');
            expect(fs.exists(lockPath)).toBe(false);
        });

        test('releases create-lock after create', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();

            await svc.create(ref, makeTaskContent());

            const lockPath = join(tempDir, '.create.lock');
            expect(fs.exists(lockPath)).toBe(false);
        });
    });

    describe('validation (step 4)', () => {
        test('throws on frontmatter that fails Zod validation', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            // Remove a required field (name) to trigger Zod validation failure.
            // `transition` changes `status` but does not touch `name`, so the
            // missing required field persists through the mutation step.
            const bad = makeTaskContent().replace('name: "Test task"\n', '');
            await fs.writeFile(ref.filePath, bad);

            await expect(svc.transition(ref, 'todo')).rejects.toThrow('validation failed');
        });
    });

    describe('History accumulation', () => {
        test('multiple transitions accumulate History lines', async () => {
            const fs = makeFs();
            const svc = new PlanningWriteService({ fs });
            const ref = makeTaskRef();
            await fs.writeFile(ref.filePath, makeTaskContent('backlog'));

            await svc.transition(ref, 'todo');
            await svc.transition(ref, 'wip');

            const written = await readBack(ref);
            const doc = MarkdownDocument.parse(written, 'task');
            const history = doc.getSection('History') ?? '';
            expect(history).toContain('backlog → todo');
        });
    });

    describe('emitter classes', () => {
        test('CapturingEmitter stores emitted events', () => {
            const emitter = new CapturingEmitter();
            const event = {
                event: 'task.created' as const,
                entity: { kind: 'task' as const, id: '0042' },
                at: '2026-01-01T00:00:00.000Z',
            };
            emitter.emit(event);
            expect(emitter.events).toHaveLength(1);
            expect(emitter.events[0]?.event).toBe('task.created');
        });

        test('NoopEventEmitter discards events silently', () => {
            const emitter = new NoopEventEmitter();
            const event = {
                event: 'task.updated' as const,
                entity: { kind: 'task' as const, id: '0042' },
                at: '2026-01-01T00:00:00.000Z',
            };
            expect(() => emitter.emit(event)).not.toThrow();
        });
    });

    describe('SchemaLifecyclePort', () => {
        test('denies transition to the same status', () => {
            const port = new SchemaLifecyclePort();
            const result = port.requestTransition(makeTaskRef(), 'wip', 'wip');
            expect(result.allowed).toBe(false);
            expect(result.report).toBe('already in this status');
        });
    });
});
