/**
 * The pinnable semantic tooltip (A821 R1) — one interaction contract for every in-place detail
 * surface.
 *
 * Pinned here so a consumer cannot quietly re-implement half of it: hover and keyboard focus open
 * the same content, activation pins it (and only then is its text selectable), Escape and outside
 * activation release it, and at most one tooltip stays pinned per document.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { PinnableTooltip } from '../../src/components/ui/PinnableTooltip';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);

const { cleanup, fireEvent, render } = await import('@testing-library/react');
afterEach(cleanup);

/** The pin click arms a 400 ms outside-click guard, so "outside" assertions wait it out. */
const waitOutPinGuard = () => new Promise((resolve) => setTimeout(resolve, 450));

function Harness({ name, testId }: { name: string; testId: string }) {
    return (
        <PinnableTooltip
            trigger={name}
            triggerLabel={`Context for ${name}`}
            title={`${name} · title`}
            testId={testId}
            triggerTestId={`${testId}-trigger`}
            footer={({ pinned }) => (pinned ? 'Select to copy' : 'Click to lock for copy')}
        >
            <p data-testid={`${testId}-body`}>detail body for {name}</p>
        </PinnableTooltip>
    );
}

describe('PinnableTooltip — preview (hover and keyboard focus)', () => {
    test('hover opens a tooltip panel with the caller content', () => {
        const view = render(<Harness name="task.updated" testId="hover-tip" />);
        // Closed until the pointer arrives: no panel, no orphan test id.
        expect(view.queryByTestId('hover-tip')).toBeNull();

        fireEvent.mouseEnter(view.getByTestId('hover-tip-trigger'));

        const panel = view.getByTestId('hover-tip');
        expect(panel.getAttribute('role')).toBe('tooltip');
        expect(panel.getAttribute('data-pinned')).toBe('false');
        expect(view.getByTestId('hover-tip-body').textContent).toBe('detail body for task.updated');
        expect(panel.textContent).toContain('task.updated · title');
        expect(panel.textContent).toContain('Click to lock for copy');
    });

    test('keyboard focus opens exactly the same content as hover', () => {
        const hovered = render(<Harness name="queue.job.failed" testId="hover-tip" />);
        fireEvent.mouseEnter(hovered.getByTestId('hover-tip-trigger'));
        const hoveredText = hovered.getByTestId('hover-tip').textContent;
        hovered.unmount();

        const focused = render(<Harness name="queue.job.failed" testId="hover-tip" />);
        // React binds `onFocus` to the bubbling `focusin`; happy-dom's `.focus()` emits only
        // `focus`, so a tab-in is delivered the way a browser delivers it.
        fireEvent.focusIn(focused.getByTestId('hover-tip-trigger'));
        const focusedPanel = focused.getByTestId('hover-tip');
        expect(focusedPanel.getAttribute('role')).toBe('tooltip');
        expect(focusedPanel.textContent).toBe(hoveredText);
    });

    test('the trigger carries the caller accessible name', () => {
        const view = render(<Harness name="rule.eval.error" testId="named-tip" />);
        const trigger = view.getByRole('button', { name: 'Context for rule.eval.error' });
        expect(trigger.getAttribute('aria-label')).toBe('Context for rule.eval.error');
        expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger.getAttribute('aria-describedby')).toBeNull();
    });
});

describe('PinnableTooltip — pinned state', () => {
    test('activation pins the panel as a selectable dialog', () => {
        const view = render(<Harness name="process.exited" testId="pin-tip" />);
        const trigger = view.getByTestId('pin-tip-trigger');

        fireEvent.click(trigger);

        const panel = view.getByTestId('pin-tip');
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('data-pinned')).toBe('true');
        // Selectable only while pinned — a hover preview must not steal text selection.
        expect(panel.className).toContain('select-text');
        expect(panel.className).toContain('fixed');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(trigger.getAttribute('aria-describedby')).toBe(panel.id);
        // The pin guidance replaces the hover guidance in the same footer slot.
        expect(panel.textContent).toContain('Select to copy');
        expect(panel.textContent).not.toContain('Click to lock for copy');
    });

    test('Escape releases the pinned panel', () => {
        const view = render(<Harness name="agent.invoke.exit" testId="esc-tip" />);
        const trigger = view.getByTestId('esc-tip-trigger');
        fireEvent.click(trigger);
        expect(view.queryByTestId('esc-tip')).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(view.queryByTestId('esc-tip')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    test('an outside pointerdown releases the pinned panel', async () => {
        const view = render(<Harness name="workflow.action.finished" testId="outside-tip" />);
        fireEvent.click(view.getByTestId('outside-tip-trigger'));
        expect(view.queryByTestId('outside-tip')).not.toBeNull();

        // Inside the panel the pin must survive a click — the text is there to be selected.
        await waitOutPinGuard();
        fireEvent.pointerDown(view.getByTestId('outside-tip-body'));
        expect(view.queryByTestId('outside-tip')).not.toBeNull();

        fireEvent.pointerDown(document.body);
        expect(view.queryByTestId('outside-tip')).toBeNull();
    });

    test('pinning a second tooltip releases the first', () => {
        const view = render(
            <div>
                <Harness name="first.event" testId="first-tip" />
                <Harness name="second.event" testId="second-tip" />
            </div>,
        );

        fireEvent.click(view.getByTestId('first-tip-trigger'));
        expect(view.getByTestId('first-tip').getAttribute('data-pinned')).toBe('true');

        fireEvent.click(view.getByTestId('second-tip-trigger'));

        expect(view.getByTestId('second-tip').getAttribute('data-pinned')).toBe('true');
        expect(view.queryByTestId('first-tip')).toBeNull();
    });
});
