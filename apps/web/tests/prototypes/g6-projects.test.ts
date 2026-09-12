/**
 * Automated interaction check for the G6 Projects prototype
 * (docs/prototypes/g6-projects/index.html), task 0830.
 *
 * Runs the self-contained HTML page in happy-dom inside apps/web and asserts
 * the frozen interaction contract. The cross-project case is load-bearing: if
 * the prototype addressed projects by display label instead of projectPath,
 * these assertions fail — which is exactly the name-based-addressing bug the
 * two identical "Aurora" fixtures exist to expose.
 *
 * DOM asserts cannot establish layout or native IME behavior; see
 * docs/reports/g6-projects-prototype.md for what stays unverified-by-browser.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';

const HTML_PATH = new URL('../../../../docs/prototypes/g6-projects/index.html', import.meta.url);
const STORE_KEY = 'spur:g6:projects-prototype:v1';
const PATH_A = '/work/aurora-auth';
const PATH_B = '/work/aurora-billing';
const A_TEXT = 'implement T-101 in aurora-auth';
const B_DRAFT = 'billing draft pending storage';

interface StoredEntry {
    kind: string;
    projectPath: string;
    projectLabel: string;
    requestId: string;
    taskId: string | null;
    featureId: string | null;
    status: string;
}
interface Stored {
    version: number;
    projects: Array<{ path: string; draft: string; entries: StoredEntry[] }>;
}

/**
 * Boot the static artifact into its own happy-dom Window and expose helpers.
 *
 * happy-dom evaluates inline scripts in a VM sandbox whose globals are
 * unreliable under Bun (`JSON` is undefined there), so script evaluation is
 * disabled and the page script runs directly in the test realm against the
 * happy-dom window. The page script only touches bare `document`/`window.*`
 * and standard intrinsics, so this is an exact substitute.
 */
function boot() {
    const html = readFileSync(HTML_PATH, 'utf8');
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom Window exposes runtime-only members
    const win: any = new Window({
        url: 'file:///docs/prototypes/g6-projects/index.html',
        settings: { disableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
    });
    win.document.write(html);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
    expect(script.length).toBeGreaterThan(0);
    new Function('window', 'document', script)(win, win.document);
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom snippet executed in the test realm
    const doc = win.document as any;
    return {
        win,
        doc,
        composer: doc.querySelector('[data-g6="composer"]') as unknown as HTMLTextAreaElement,
        select: doc.querySelector('#project-select') as unknown as HTMLSelectElement,
        fixture: (name: string): HTMLButtonElement =>
            doc.querySelector(`[data-g6-fixture="${name}"]`) as unknown as HTMLButtonElement,
        // biome-ignore lint/suspicious/noExplicitAny: happy-dom node list in test realm
        entries: (): any[] => [...doc.querySelectorAll('[data-g6-entry-id]')],
        live: () => {
            const el = doc.querySelector('#g6-live') as unknown as HTMLElement;
            return el.textContent ?? '';
        },
        storage: (): Stored => JSON.parse((win.localStorage.getItem(STORE_KEY) ?? 'null') as string),
        rawStorage: () => win.localStorage.getItem(STORE_KEY),
    };
}
type Rig = ReturnType<typeof boot>;

function projectOf(stored: Stored, path: string): { draft: string; entries: StoredEntry[] } {
    const hit = stored.projects.find((p) => p.path === path);
    if (!hit) throw new Error(`project ${path} missing from prototype storage`);
    return hit;
}

function typeInto(rig: Rig, text: string): void {
    rig.composer.value = text;
    rig.composer.dispatchEvent(new rig.win.Event('input', { bubbles: true }));
}

function pressEnter(rig: Rig, opts: { shift?: boolean; ime?: boolean } = {}): void {
    rig.composer.dispatchEvent(
        new rig.win.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            shiftKey: opts.shift ?? false,
            isComposing: opts.ime ?? false,
        }),
    );
}

function selectProject(rig: Rig, path: string): void {
    rig.select.value = path;
    rig.select.dispatchEvent(new rig.win.Event('change', { bubbles: true }));
}

/** Click the focused conversation's "Durable accept now" row action. */
function acceptPending(rig: Rig): void {
    const button = [...rig.doc.querySelectorAll('button')].find((b) => b.textContent?.includes('Durable accept now'));
    expect(button).toBeDefined();
    button?.click();
}

describe('g6-projects prototype (task 0830)', () => {
    test('boots standalone: Conversation is the default view; header shows worktree/strategy/orchestrator/capacity', () => {
        const rig = boot();
        expect(rig.live()).toContain('prototype ready');
        expect((rig.doc.querySelector('#view-conversation') as HTMLElement).hidden).toBe(false);
        expect((rig.doc.querySelector('#hdr-worktree') as HTMLElement).textContent).toContain('aurora-auth');
        expect((rig.doc.querySelector('#hdr-storage-note') as HTMLElement).textContent).toContain(STORE_KEY);
        for (const id of ['hdr-strategy', 'hdr-orch', 'hdr-capacity']) {
            const text = (rig.doc.querySelector(`#${id}`) as HTMLElement).textContent ?? '';
            expect(text.length).toBeGreaterThan(0);
        }
    });

    test('cross-project isolation: receipt/result stay in their captured project; no draft is cleared or overwritten', () => {
        const rig = boot();
        // Link a Work task into A's own conversation, then submit with it →
        // pending receipt with taskId/featureId captured at submission.
        selectProject(rig, PATH_A);
        (rig.doc.querySelector('#tab-work') as HTMLButtonElement).click();
        (rig.doc.querySelector('[data-g6="use-task"]') as HTMLButtonElement).click();
        expect(rig.doc.querySelector('[data-g6="task-chip"]')).not.toBeNull();
        typeInto(rig, A_TEXT);
        pressEnter(rig);
        expect(rig.live()).toContain('captured in project /work/aurora-auth');
        expect(rig.entries().length).toBe(1);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('pending');
        expect(projectOf(rig.storage(), PATH_A).draft).toBe(A_TEXT);

        // Switching away and back retains A's draft (per-project draft storage).
        selectProject(rig, PATH_B);
        expect(rig.composer.value).toBe('');
        selectProject(rig, PATH_A);
        expect(rig.composer.value).toBe(A_TEXT);
        selectProject(rig, PATH_B);

        // Submit a B-only draft → B keeps only its own request.
        typeInto(rig, B_DRAFT);
        pressEnter(rig);
        expect(rig.composer.value).toBe(B_DRAFT); // pending too
        expect(projectOf(rig.storage(), PATH_B).draft).toBe(B_DRAFT);
        expect(projectOf(rig.storage(), PATH_A).draft).toBe(A_TEXT);

        // A's durable acceptance clears ONLY A's submitted revision.
        selectProject(rig, PATH_A);
        acceptPending(rig);
        expect(rig.composer.value).toBe('');
        expect(projectOf(rig.storage(), PATH_A).draft).toBe('');
        expect(projectOf(rig.storage(), PATH_B).draft).toBe(B_DRAFT); // untouched by A

        // A late verified result for A's request arrives while B is focused.
        selectProject(rig, PATH_B);
        rig.fixture('late-result').click();
        expect(rig.live()).toContain('project /work/aurora-auth'); // lands in the originating project
        expect(rig.composer.value).toBe(B_DRAFT);
        for (const row of rig.entries()) {
            expect(row.getAttribute('data-g6-entry-project')).toBe(PATH_B); // visible B conversation shows B only
        }

        // Storage carries the split.
        const stored = rig.storage();
        expect(stored.version).toBe(1);
        const a = projectOf(stored, PATH_A);
        const b = projectOf(stored, PATH_B);
        expect(a.entries.filter((e) => e.kind === 'request').length).toBe(1);
        expect(a.entries.filter((e) => e.kind === 'result').length).toBe(1);
        for (const entry of a.entries) expect(entry.projectPath).toBe(PATH_A);
        for (const entry of b.entries) {
            expect(entry.projectPath).toBe(PATH_B);
            expect(entry.kind).toBe('request');
        }
        const aFirst = a.entries[0] as StoredEntry;
        expect(aFirst.requestId).toMatch(/^req-\d+a$/);
        expect(aFirst.taskId).toBe('T-101');
        expect(aFirst.featureId).toBe('G6');
        expect(aFirst.projectLabel).toBe('Aurora');

        // Simulated refresh: the per-project split survives rehydration, and
        // accepting B clears only B's revision.
        rig.fixture('rehydrate').click();
        selectProject(rig, PATH_B);
        expect(rig.composer.value).toBe(B_DRAFT);
        acceptPending(rig);
        expect(rig.composer.value).toBe('');
        const after = rig.storage();
        expect(projectOf(after, PATH_A).draft).toBe('');
        expect(projectOf(after, PATH_B).draft).toBe('');
    });

    test('composer keyboard contract: Enter submits a pending receipt; Shift+Enter newline; IME Enter never submits', () => {
        const rig = boot();
        selectProject(rig, PATH_A);
        // Empty composer: Enter does nothing.
        typeInto(rig, '');
        pressEnter(rig);
        expect(rig.entries().length).toBe(0);
        // Shift+Enter does not submit (textarea inserts the newline natively).
        typeInto(rig, A_TEXT);
        pressEnter(rig, { shift: true });
        expect(rig.entries().length).toBe(0);
        // Enter during IME composition never submits.
        pressEnter(rig, { ime: true });
        expect(rig.entries().length).toBe(0);
        // Plain Enter submits a pending receipt and retains the submitted draft.
        pressEnter(rig);
        expect(rig.entries().length).toBe(1);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('pending');
        expect(rig.composer.value).toBe(A_TEXT);
        expect((rig.doc.querySelector('#storage-notice') as HTMLElement).hidden).toBe(true);
    });

    test('idempotent retry: failure keeps the draft; same immutable payload keeps the requestId; changed payload mints a new one', () => {
        const rig = boot();
        selectProject(rig, PATH_B);
        rig.fixture('netfail').click();
        typeInto(rig, 'retry me please');
        pressEnter(rig);
        acceptPending(rig); // acceptance attempt fails while network failure is armed
        const failed = rig.entries()[0];
        expect(failed.getAttribute('data-g6-entry-status')).toBe('failed-delivery');
        const failedId = failed.getAttribute('data-g6-entry-request-id') as string;
        expect(failedId).toMatch(/^req-\d+b$/);
        expect(rig.composer.value).toBe('retry me please'); // draft preserved on failure
        expect(rig.live()).toContain('Draft preserved');

        // Same immutable payload re-submitted from the composer → same requestId, no new row.
        typeInto(rig, 'retry me please');
        pressEnter(rig);
        expect(rig.entries().length).toBe(1);
        expect(rig.entries()[0].getAttribute('data-g6-entry-request-id')).toBe(failedId);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('pending'); // retry re-armed
        expect(rig.live()).toContain('same immutable payload');

        // Resubmitting the same payload while the retry is pending → duplicate suppressed.
        pressEnter(rig);
        expect(rig.entries().length).toBe(1);
        expect(rig.entries()[0].textContent).toContain('attempts');
        expect(rig.live()).toContain('Duplicate suppressed');

        // Changed payload → a NEW requestId row.
        typeInto(rig, 'retry me please EDITED');
        pressEnter(rig);
        expect(rig.entries().length).toBe(2);
        expect(rig.entries()[1].getAttribute('data-g6-entry-request-id')).not.toBe(failedId);
        // The failed draft revision survives next to the newer immutable payload.
        expect(projectOf(rig.storage(), PATH_B).draft).toBe('retry me please EDITED');
        expect(projectOf(rig.storage(), PATH_B).entries.length).toBe(2);
    });

    test('retry identity survives refresh: failed-delivery row rehydrates and the same payload re-arms the SAME requestId', () => {
        const rig = boot();
        selectProject(rig, PATH_B);
        typeInto(rig, 'retry across refresh');
        pressEnter(rig);
        // Force the pending receipt into failed-delivery.
        rig.fixture('failed-delivery').click();
        acceptPending(rig); // acceptance attempt fails while network failure is armed
        const failed = rig.entries()[0];
        expect(failed.getAttribute('data-g6-entry-status')).toBe('failed-delivery');
        const failedId = failed.getAttribute('data-g6-entry-request-id') as string;
        expect(rig.composer.value).toBe('retry across refresh'); // draft preserved on failure

        // Serialized retry identity: the failed project carries lastFailedId/lastFailedKey.
        const stored = projectOf(rig.storage(), PATH_B) as {
            draft: string;
            entries: StoredEntry[];
            lastFailedId: string | null;
            lastFailedKey: string | null;
        };
        expect(stored.lastFailedId).toBe(failedId);
        expect(stored.lastFailedKey).toContain('retry across refresh');

        // Simulated refresh: rehydrate from the stored bytes; retry identity must survive.
        rig.fixture('rehydrate').click();
        selectProject(rig, PATH_B);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('failed-delivery');
        expect(rig.entries()[0].getAttribute('data-g6-entry-request-id')).toBe(failedId);
        expect(rig.composer.value).toBe('retry across refresh'); // draft survived rehydration

        // Re-send the same payload → retry re-arms the SAME requestId, no new row.
        typeInto(rig, 'retry across refresh');
        pressEnter(rig);
        expect(rig.entries().length).toBe(1);
        expect(rig.entries()[0].getAttribute('data-g6-entry-request-id')).toBe(failedId);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('pending');
        expect(rig.live()).toContain('same immutable payload');
        // A second same-payload send while the retry is pending is still suppressed.
        pressEnter(rig);
        expect(rig.entries().length).toBe(1);
        expect(rig.live()).toContain('Duplicate suppressed');
    });

    test('durable receipt with no active orchestrator is labeled queued-awaiting-orchestrator, never working', () => {
        const rig = boot();
        selectProject(rig, PATH_A);
        rig.fixture('zero-agent').click();
        typeInto(rig, A_TEXT);
        pressEnter(rig);
        acceptPending(rig);
        const row = rig.entries()[0];
        expect(row.getAttribute('data-g6-entry-status')).toBe('queued-awaiting-orchestrator');
        expect(row.textContent).toContain('NOT “working”');
        expect(row.textContent).toContain('Available action');
        expect((rig.doc.querySelector('#hdr-orch') as HTMLElement).textContent).toContain('zero agent fleet');
    });

    test('R3 fixture states render honest labels with their available actions', () => {
        const rig = boot();
        selectProject(rig, PATH_A);
        const cases: Array<[fixture: string, expectText: string, rowStatus: string]> = [
            ['orch-missing', 'orchestrator missing', 'queued-awaiting-orchestrator'],
            ['orch-offline', 'orchestrator offline', 'queued-awaiting-orchestrator'],
            ['rest-held', 'rest-active', 'rest-held'],
            ['executor-unavailable', 'executor unavailable', 'executor-unavailable'],
            ['blocked', 'blocked', 'blocked'],
            ['failed-delivery', 'network failure', 'failed-delivery'],
        ];
        for (const [name, expectText, rowStatus] of cases) {
            rig.fixture('reset').click();
            rig.fixture(name).click();
            expect((rig.doc.querySelector('#state-cards') as HTMLElement).textContent).toContain(expectText);
            if (name.startsWith('orch-')) {
                // The header reacts only to orchestrator-bound state changes.
                expect((rig.doc.querySelector('#hdr-orch') as HTMLElement).textContent).toContain(
                    expectText.split(' ').pop() ?? '',
                );
            }
            typeInto(rig, `state probe ${name}`);
            pressEnter(rig);
            acceptPending(rig);
            const row = rig.entries().at(-1) as HTMLElement;
            expect(row.getAttribute('data-g6-entry-status')).toBe(rowStatus);
            expect(row.textContent).toContain('Available action');
        }
    });

    test('outcome-unknown offers inspect/reconcile guidance, not an unconditional retry; run exit ≠ verified result', () => {
        const rig = boot();
        selectProject(rig, PATH_A);
        typeInto(rig, 'exit without verifiable receipt');
        pressEnter(rig);
        acceptPending(rig);
        rig.fixture('outcome-unknown').click();
        const row = rig.entries()[0];
        expect(row.getAttribute('data-g6-entry-status')).toBe('outcome-unknown');
        expect(row.textContent).toContain('reconcile');
        expect(rig.live()).toContain('outcome-unknown');
        // No unconditional retry control exists in the outcome-unknown state.
        const retryButtons = [...row.querySelectorAll('button')].filter((b) => /retry/i.test(b.textContent ?? ''));
        expect(retryButtons.length).toBe(0);

        // Run exit alone renders as unverified, never a verified result.
        selectProject(rig, PATH_B);
        rig.fixture('reset').click();
        typeInto(rig, 'exit only demo');
        pressEnter(rig);
        acceptPending(rig);
        const exitBtn = [...rig.doc.querySelectorAll('button')].find((b) => b.textContent?.includes('run-exit-only'));
        expect(exitBtn).toBeDefined();
        exitBtn?.click();
        const exitRow = rig.entries().slice(-1)[0];
        expect(exitRow.getAttribute('data-g6-entry-status')).toBe('completed-exit-only');
        expect(exitRow.textContent).toContain('NOT a verified result');
    });

    test('invalid prototype storage: nonfatal notice, stored bytes untouched, page stays usable', () => {
        const rig = boot();
        selectProject(rig, PATH_B);
        rig.fixture('corrupt-storage').click();
        const notice = rig.doc.querySelector('#storage-notice') as HTMLElement;
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain('invalid storage payload');
        expect(rig.rawStorage()).toBe('{"version":1,"projects":[broken');
        expect(rig.rawStorage()?.startsWith('{"version":1')).toBe(true);
        typeInto(rig, 'fresh after corruption');
        pressEnter(rig);
        expect(rig.entries()[0].getAttribute('data-g6-entry-status')).toBe('pending');
    });

    test('agents inspection: detail panels are visibly mock; Esc closes and restores focus to the opener', () => {
        const rig = boot();
        selectProject(rig, PATH_B);
        rig.fixture('reset').click();
        (rig.doc.querySelector('#tab-agents') as HTMLButtonElement).click();
        const openers = [...rig.doc.querySelectorAll('[data-g6="open-member"]')];
        const opener = openers[1] as HTMLElement;
        opener.click();
        const detail = rig.doc.querySelector('#agent-detail') as HTMLElement;
        expect(detail.hidden).toBe(false);
        const panel = rig.doc.querySelector('#agent-detail-panel') as HTMLElement;
        for (const label of ['Process', 'Terminal', 'Messages', 'Activity']) {
            const tab = [...rig.doc.querySelectorAll('[data-detail-tab]')].find((t) => t.textContent?.includes(label));
            expect(tab).toBeDefined();
            tab?.click();
            expect(tab?.getAttribute('aria-selected')).toBe('true');
            expect(panel.textContent).toContain('MOCK');
        }
        rig.doc.dispatchEvent(new rig.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(detail.hidden).toBe(true);
        // Focus is restored to the opener's member button after re-render.
        const restoredMember = (rig.doc.activeElement as HTMLElement | null)?.getAttribute('data-g6-member');
        expect(restoredMember).toBe(opener.getAttribute('data-g6-member'));
    });

    test('work view links a task into the SAME conversation and captures taskId/featureId at submission', () => {
        const rig = boot();
        selectProject(rig, PATH_A);
        (rig.doc.querySelector('#tab-work') as HTMLButtonElement).click();
        (rig.doc.querySelector('[data-g6="use-task"]') as HTMLButtonElement).click();
        expect((rig.doc.querySelector('#view-conversation') as HTMLElement).hidden).toBe(false);
        expect(rig.doc.querySelector('[data-g6="task-chip"]')).not.toBeNull();
        typeInto(rig, A_TEXT);
        pressEnter(rig);
        const entry = projectOf(rig.storage(), PATH_A).entries[0] as StoredEntry;
        expect(entry.taskId).toBe('T-101');
        expect(entry.featureId).toBe('G6');
        expect(entry.projectPath).toBe(PATH_A);
        // Tabs: arrow-key keyboard selection updates aria-selected.
        (rig.doc.querySelector('#tab-conversation') as HTMLButtonElement).focus();
        rig.doc
            .querySelector('#g6-tabs')
            .dispatchEvent(new rig.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect((rig.doc.querySelector('#tab-agents') as HTMLElement).getAttribute('aria-selected')).toBe('true');
        expect(rig.live()).toContain('View selected');
    });

    test('identical display labels cannot retarget requests: identity keys on paths, not names', () => {
        const rig = boot();
        const options = [...rig.select.options];
        expect(options.length).toBe(2);
        // Both fixtures advertise exactly the identical display label.
        expect(new Set(options.map((o) => o.textContent)).size).toBe(1);
        expect(options.every((o) => o.textContent === 'Aurora')).toBe(true);
        // But option values key on the two distinct project paths.
        expect(new Set(options.map((o) => o.value))).toEqual(new Set([PATH_A, PATH_B]));
        // A request rendered while focused shows both path and identical label.
        selectProject(rig, PATH_A);
        typeInto(rig, A_TEXT);
        pressEnter(rig);
        const row = rig.entries()[0];
        expect(row.getAttribute('data-g6-entry-project')).toBe(PATH_A);
        expect(row.textContent).toContain('Aurora');
        expect(row.textContent).toContain(PATH_A);
    });
});
