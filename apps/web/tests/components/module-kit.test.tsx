/**
 * Board module UI kit (A81 1348) — the shell primitives a built-in and a downstream native
 * module now share.
 *
 * Two things are pinned here: the ARIA/controlled contract each primitive exposes (so an
 * adopting shell and a contribution get the same behavior), and the kit's context freedom —
 * contributions share React but not host context, so a router/rpc/registry import inside the
 * kit would be invisible until a downstream module mounted.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    Diagnostic,
    EmptyState,
    ModuleHeader,
    ModuleShell,
    ModuleTabs,
    TimeRangePresets,
} from '../../src/components/module-kit';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

const { cleanup, fireEvent, render } = await import('@testing-library/react');
// `render` queries resolve against document.body, so each mounted tree must be unmounted
// before the next test or a later `getByRole` sees two.
afterEach(cleanup);

const TABS = [
    { id: 'events', label: 'Events' },
    { id: 'jobs', label: 'Jobs' },
] as const;

describe('ModuleTabs (R4 — tab ARIA and controlled change)', () => {
    test('renders a tablist of tabs whose selection follows `value`', () => {
        const view = render(
            <ModuleTabs tabs={TABS} value="jobs" onChange={() => {}} label="Shell tabs" idPrefix="shell-tab" />,
        );
        const list = view.getByRole('tablist', { name: 'Shell tabs' });
        expect(list).toBeTruthy();
        const tabs = view.getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Events', 'Jobs']);
        expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true']);
        expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    });

    test('pairs each tab with the panel id its caller must render', () => {
        const view = render(
            <ModuleTabs tabs={TABS} value="events" onChange={() => {}} label="Shell tabs" idPrefix="shell-tab" />,
        );
        const [first] = view.getAllByRole('tab');
        expect(first?.id).toBe('shell-tab-events');
        expect(first?.getAttribute('aria-controls')).toBe('shell-tab-panel-events');
    });

    test('a tab badge renders after its label, and only when present (A83 1427)', () => {
        const view = render(
            <ModuleTabs
                tabs={[
                    { id: 'summary', label: 'Summary', badge: 12 },
                    { id: 'sources', label: 'Sources', badge: null },
                    { id: 'traces', label: 'Traces' },
                ]}
                value="summary"
                onChange={() => {}}
                label="Badge tabs"
                idPrefix="history"
            />,
        );
        const badge = view.getByTestId('history-badge-summary');
        expect(badge.textContent).toBe('12');
        // `null` and an absent field both render nothing — no empty badge shell.
        expect(view.queryByTestId('history-badge-sources')).toBeNull();
        expect(view.queryByTestId('history-badge-traces')).toBeNull();
    });

    test('ArrowLeft/ArrowRight move the selection and focus (A83 1426)', () => {
        const picked: string[] = [];
        const view = render(
            <ModuleTabs
                tabs={TABS}
                value="events"
                onChange={(id) => picked.push(id)}
                label="Shell tabs"
                idPrefix="shell-tab"
            />,
        );
        const strip = view.getByRole('tablist', { name: 'Shell tabs' });
        fireEvent.keyDown(strip, { key: 'ArrowRight' });
        expect(picked).toEqual(['jobs']);
        // An unrelated key is left to the browser.
        fireEvent.keyDown(strip, { key: 'a' });
        expect(picked).toHaveLength(1);
    });

    test('the arrow keys wrap in both directions', () => {
        // From the LAST tab, Right wraps to the first; from the first, Left wraps to the last.
        const forward: string[] = [];
        const last = render(
            <ModuleTabs tabs={TABS} value="jobs" onChange={(id) => forward.push(id)} label="L" idPrefix="l" />,
        );
        fireEvent.keyDown(last.getByRole('tablist', { name: 'L' }), { key: 'ArrowRight' });
        expect(forward).toEqual(['events']);

        const backward: string[] = [];
        const first = render(
            <ModuleTabs tabs={TABS} value="events" onChange={(id) => backward.push(id)} label="B" idPrefix="b" />,
        );
        fireEvent.keyDown(first.getByRole('tablist', { name: 'B' }), { key: 'ArrowLeft' });
        expect(backward).toEqual(['jobs']);
    });

    test('reports the clicked tab id and owns no state of its own', () => {
        const picked: string[] = [];
        const view = render(
            <ModuleTabs
                tabs={TABS}
                value="events"
                onChange={(id) => picked.push(id)}
                label="Shell tabs"
                idPrefix="shell-tab"
            />,
        );
        const tab = view.getByRole('tab', { name: 'Jobs' });
        fireEvent.click(tab);
        expect(picked).toEqual(['jobs']);
        // Uncontrolled clicks never move the selection: `value` is still authoritative.
        expect(tab.getAttribute('aria-selected')).toBe('false');
    });
});

describe('TimeRangePresets (R4 — controlled range group)', () => {
    test('marks the active preset and renders `all` as a word', () => {
        const view = render(<TimeRangePresets presets={['1h', '4h', 'all'] as const} value="4h" onChange={() => {}} />);
        const group = view.getByRole('group', { name: 'Time range presets' });
        expect(group.tagName).toBe('FIELDSET');
        const pressed = view
            .getAllByRole('button')
            .map((button) => [button.textContent, button.getAttribute('aria-pressed')]);
        expect(pressed).toEqual([
            ['1h', 'false'],
            ['4h', 'true'],
            ['All', 'false'],
        ]);
    });

    test('reports the clicked preset to the caller', () => {
        const picked: string[] = [];
        const view = render(
            <TimeRangePresets presets={['1h', 'all'] as const} value="all" onChange={(next) => picked.push(next)} />,
        );
        fireEvent.click(view.getByRole('button', { name: '1h' }));
        expect(picked).toEqual(['1h']);
    });
});

describe('ModuleShell / ModuleHeader (R3 — one shell anatomy)', () => {
    test('the shell owns the centered rail and passes extra attributes through', () => {
        const view = render(
            <ModuleShell data-test-module="x" aria-label="module shell">
                <p>body</p>
            </ModuleShell>,
        );
        const root = view.container.firstElementChild as HTMLElement;
        expect(root.className).toContain('max-w-[1600px]');
        expect(root.className).toContain('mx-auto');
        expect(root.getAttribute('data-test-module')).toBe('x');
        expect(root.getAttribute('aria-label')).toBe('module shell');
        expect(root.textContent).toBe('body');
    });

    test('the header renders identity, optional status, filters and tabs in one row', () => {
        const view = render(
            <ModuleHeader
                icon={<span data-testid="icon" />}
                title="Shell"
                subtitle="one row"
                status={<span role="status">live</span>}
                filters={<span data-testid="filters" />}
                tabs={<span data-testid="tabs" />}
            />,
        );
        expect(view.getByRole('heading', { level: 1 }).textContent).toBe('Shell');
        expect(view.getByText('one row')).toBeTruthy();
        expect(view.getByRole('status').textContent).toBe('live');
        expect(view.getByTestId('filters')).toBeTruthy();
        expect(view.getByTestId('tabs')).toBeTruthy();
        expect(view.getByTestId('icon')).toBeTruthy();
    });

    test('the extracted primitives keep the ADR-081 shell classes (no visual change on adoption)', () => {
        const view = render(
            <ModuleHeader
                icon={<span />}
                title="Shell"
                status={<span role="status">live</span>}
                filters={<span />}
                tabs={
                    <ModuleTabs
                        tabs={TABS}
                        value="events"
                        onChange={() => {}}
                        label="Shell tabs"
                        idPrefix="shell-tab"
                    />
                }
            />,
        );
        const header = view.getByRole('heading', { level: 1 }).closest('div')?.parentElement?.parentElement;
        expect(header?.className).toContain('border-b border-base-content/10 pb-3');
        expect(header?.className).toContain('flex-wrap items-center justify-between gap-4');
        expect(view.getByRole('tablist').className).toContain('bg-base-300 p-1 rounded-xl');
        expect(view.getByRole('tab', { name: 'Events' }).className).toContain('bg-primary text-primary-content');
    });
});

describe('EmptyState / Diagnostic (R1 — standard states)', () => {
    test('an empty state carries the module test id and its message', () => {
        const view = render(<EmptyState testId="jobs-empty-state">No jobs found in this time range.</EmptyState>);
        const empty = view.getByTestId('jobs-empty-state');
        expect(empty.textContent).toBe('No jobs found in this time range.');
        expect(empty.className).toContain('italic');
    });

    test('a diagnostic alerts by default, announces a warning, and keeps its data anchors', () => {
        const error = render(
            <Diagnostic
                testId="diag"
                data-module-id="m1"
                title="Could not render"
                detail="why"
                code="import: x"
                hint="reload"
            />,
        );
        const alert = error.getByTestId('diag');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.getAttribute('data-module-id')).toBe('m1');
        expect(alert.textContent).toContain('Could not render');
        expect(alert.textContent).toContain('import: x');
        expect(alert.textContent).toContain('reload');
        error.unmount();

        const warning = render(<Diagnostic testId="warn" tone="warning" title="Heads up" />);
        expect(warning.getByTestId('warn').getAttribute('role')).toBe('status');
    });
});

describe('R2 — the kit stays context-free', () => {
    const KIT_DIR = join(import.meta.dir, '..', '..', 'src', 'components', 'module-kit');
    const sources = readdirSync(KIT_DIR)
        .filter((file) => file.endsWith('.ts') || file.endsWith('.tsx'))
        .map((file) => [file, readFileSync(join(KIT_DIR, file), 'utf8')] as const);

    test('no kit file imports a router, rpc client, registry or module store', () => {
        for (const [file, source] of sources) {
            expect(source, `${file} must not reach host context`).not.toMatch(
                /from '(?:react-router|.*rpc-client|.*registry|\.\.\/\.\.\/modules)/,
            );
            expect(source, `${file} must not create context`).not.toMatch(/\bcreateContext\b|\buseSearchParams\b/);
        }
    });

    test('the barrel is value-export only, with no default export', () => {
        const barrel = readFileSync(join(KIT_DIR, 'index.ts'), 'utf8');
        expect(barrel).not.toContain('export default');
        for (const name of [
            'ModuleShell',
            'ModuleHeader',
            'ModuleTabs',
            'TimeRangePresets',
            'EmptyState',
            'Diagnostic',
            'Loading',
            'Card',
            'Badge',
            'Button',
        ]) {
            expect(barrel, `barrel must export ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
        }
    });
});
