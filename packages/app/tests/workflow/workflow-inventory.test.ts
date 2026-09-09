/**
 * Tests for workflow inventory projection validation / identity binding (0814 R4)
 * and event-trace rendering (0814 R8). Pure functions — no CLI or YAML I/O.
 */
import { describe, expect, test } from 'bun:test';
import {
    assertInventoryIdentity,
    parseWorkflowInventory,
    renderEventTrace,
} from '../../src/workflow/workflow-inventory';

const validJson = {
    name: 'task-pipeline',
    kind: 'state-machine',
    format: 'todo',
    version: '3',
    definitionDigest: 'sha256:485542ce686c31dbec23caf265b78d7ecfa323f8bc7a5ef1174a04898e265bb7',
    steps: [
        {
            id: 'precheck',
            initial: true,
            terminal: false,
            failure: false,
            pause: false,
            loopBack: false,
            conditional: false,
        },
        {
            id: 'implement',
            initial: false,
            terminal: false,
            failure: false,
            pause: false,
            loopBack: false,
            conditional: true,
        },
        {
            id: 'done',
            initial: false,
            terminal: true,
            failure: false,
            pause: false,
            loopBack: false,
            conditional: false,
        },
    ],
};

describe('parseWorkflowInventory (0814 R4)', () => {
    test('accepts a well-formed todo projection and normalizes it', () => {
        const r = parseWorkflowInventory(validJson);
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.inventory.name).toBe('task-pipeline');
            expect(r.inventory.definitionDigest).toContain('sha256:');
            expect(r.inventory.steps.map((s) => s.id)).toEqual(['precheck', 'implement', 'done']);
        }
    });

    test('fails closed on unresolved / missing identity fields', () => {
        expect(parseWorkflowInventory(null).ok).toBe(false);
        expect(parseWorkflowInventory({ name: 'x' }).ok).toBe(false); // no kind/version/digest/steps
        expect(parseWorkflowInventory({ ...validJson, definitionDigest: '' }).ok).toBe(false);
        expect(parseWorkflowInventory({ ...validJson, steps: [] }).ok).toBe(false);
        expect(parseWorkflowInventory({ ...validJson, steps: [{ id: '' }] }).ok).toBe(false);
    });

    test('accepts a known-unversioned projection (version null/absent, schema preserved)', () => {
        // The CLI emits `version: null` for an unversioned definition (0814 R4: preserve
        // the existing JSON schema) — a valid projection, not an identity failure.
        const r = parseWorkflowInventory({ ...validJson, version: null });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.inventory.version).toBe('');
        const absent = parseWorkflowInventory({ ...validJson });
        expect(absent.ok).toBe(true);
    });
});

describe('assertInventoryIdentity (0814 R4)', () => {
    test('accepts a matching digest and rejects drift / unbound', () => {
        const parsed = parseWorkflowInventory(validJson);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        const inventory = parsed.inventory;
        expect(assertInventoryIdentity(inventory, inventory.definitionDigest).ok).toBe(true);
        expect(assertInventoryIdentity(inventory, 'sha256:other').ok).toBe(false);
        expect(assertInventoryIdentity(inventory, '').ok).toBe(false);
    });
});

describe('renderEventTrace (0814 R8)', () => {
    test('renders ordered, timestamped events with detail', () => {
        expect(
            renderEventTrace([
                { at: '2026-09-08T17:50:00Z', kind: 'checklist-visible' },
                { at: '2026-09-08T17:50:01Z', kind: 'worktree-created', detail: 'cwd=/worktree' },
            ]),
        ).toBe(
            ['2026-09-08T17:50:00Z checklist-visible', '2026-09-08T17:50:01Z worktree-created — cwd=/worktree'].join(
                '\n',
            ),
        );
    });
});
