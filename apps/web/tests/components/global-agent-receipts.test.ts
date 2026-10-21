import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();

const { act, cleanup, fireEvent, render, renderHook, waitFor } = await import('@testing-library/react');
const { createElement } = await import('react');
const { default: GlobalAgentBar, receiptStateFor } = await import('../../src/components/GlobalAgentBar');
const { resetFetchForTesting, setFetchForTesting } = await import('../../src/lib/rpc-client');
const { ConversationDraftProvider, useConversationDraft } = await import('../../src/modules/projects/drafts');
const { ProjectContext } = await import('../../src/modules/projects/useProjectContext');

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
    localStorage.clear();
    mock.restore();
});

describe('global composer exact receipts', () => {
    test('a captured draft clear cannot erase an equal-revision draft from another project', async () => {
        let path = '/project/A';
        const wrapper = ({ children }: Parameters<typeof ConversationDraftProvider>[0]) =>
            createElement(
                ProjectContext.Provider,
                { value: { path, name: path, fleet: null, state: 'ready' } as never },
                createElement(ConversationDraftProvider, null, children),
            );
        const { result, rerender } = renderHook(useConversationDraft, { wrapper });
        act(() => result.current.setText('A revision one'));
        const clearA = result.current.clearSubmitted;
        const revisionA = result.current.draft.revision;
        path = '/project/B';
        rerender();
        await waitFor(() => expect(result.current.draft.path).toBe(path));
        act(() => result.current.setText('B revision one'));
        expect(result.current.draft.revision).toBe(revisionA);
        act(() => clearA(revisionA, '/project/A'));
        expect(result.current.draft.text).toBe('B revision one');
    });

    test.each([
        { outcome: 'success', revisit: false },
        { outcome: 'failure', revisit: false },
        { outcome: 'success', revisit: true },
    ])(
        'a stale send cannot change the current equal-revision draft or active send (%j)',
        async ({ outcome, revisit }) => {
            const pending: Array<(response: Response) => void> = [];
            const sent: Array<Record<string, unknown>> = [];
            const receiptUrls: string[] = [];
            const json = (value: unknown, status = 200) =>
                new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
            setFetchForTesting((async (input: Request) => {
                const url = new URL(input.url);
                if (url.pathname === '/api/inbox/messages' && input.method === 'POST') {
                    sent.push(await input.json());
                    return new Promise<Response>((resolve) => pending.push(resolve));
                }
                if (url.pathname === '/api/inbox/requests') {
                    receiptUrls.push(input.url);
                    return json([]);
                }
                return json({ commands: [] });
            }) as typeof fetch);
            const tree = (path: string) =>
                createElement(
                    ProjectContext.Provider,
                    {
                        value: {
                            path,
                            name: path,
                            state: 'ready',
                            fleet: {
                                orchestrator: { state: 'bound-online', instanceId: 'shared-planner' },
                                members: [],
                            },
                        } as never,
                    },
                    createElement(ConversationDraftProvider, null, createElement(GlobalAgentBar)),
                );
            const view = render(tree('/project/A'));
            fireEvent.click(view.getByRole('button', { name: 'Open agent prompt bar' }));
            const typeAndSend = (text: string) => {
                const box = view.getByRole('textbox', { name: 'Agent prompt' });
                fireEvent.focusIn(box);
                fireEvent.change(box, { target: { value: text } });
                fireEvent.keyUp(box);
                fireEvent.keyDown(box, { key: 'Enter' });
            };
            typeAndSend('A revision one');
            await waitFor(() => expect(sent).toHaveLength(1));
            view.rerender(tree('/project/B'));
            await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
            if (revisit) {
                view.rerender(tree('/project/A'));
                await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
            }
            const currentText = revisit ? 'fresh A revision one' : 'B revision one';
            typeAndSend(currentText);
            await waitFor(() => expect(sent).toHaveLength(2));
            expect(sent.map((row) => row.projectPath)).toEqual(['/project/A', revisit ? '/project/A' : '/project/B']);
            await act(async () =>
                pending[0]?.(
                    outcome === 'success'
                        ? json({ message: { id: 'msg_A', status: 'delivered' }, replayed: false })
                        : json({ message: 'A send failed' }, 500),
                ),
            );
            expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(currentText);
            expect(view.container.textContent).toContain('Sending');
            expect(view.container.textContent).not.toContain('A send failed');
            expect(receiptUrls).toEqual([]);
            await act(async () => pending[1]?.(json({ message: { id: 'msg_B', status: 'queued' }, replayed: false })));
            await waitFor(() => expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''));
            await waitFor(() => expect(receiptUrls).toHaveLength(1));
            expect(new URL(receiptUrls[0] ?? '').searchParams.get('messageId')).toBe('msg_B');
        },
    );

    test('accepted chat seeds delivery immediately and refreshes the selected member by message id', async () => {
        const intervals = spyOn(globalThis, 'setInterval');
        const cleared = spyOn(globalThis, 'clearInterval');
        const sent: Array<Record<string, unknown>> = [];
        const receiptUrls: string[] = [];
        let finishReceipt: (response: Response) => void = () => {};
        const receipt = new Promise<Response>((resolve) => {
            finishReceipt = resolve;
        });
        const json = (value: unknown) =>
            new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
        setFetchForTesting((async (input: Request) => {
            const url = new URL(input.url);
            if (url.pathname === '/api/inbox/messages' && input.method === 'POST') {
                sent.push(await input.json());
                return json({
                    message: { id: sent.length === 1 ? 'msg_chat' : 'msg_active', status: 'queued' },
                    replayed: false,
                });
            }
            if (url.pathname === '/api/inbox/requests') {
                receiptUrls.push(input.url);
                if (url.searchParams.get('messageId') === 'msg_active') return new Promise<Response>(() => {});
                return receiptUrls.length === 1
                    ? receipt
                    : json([{ messageId: 'msg_chat', status: 'delivered', reason: null, runStatus: 'exited' }]);
            }
            return json({ commands: [] });
        }) as typeof fetch);
        const project = {
            path: '/tmp/proj',
            name: 'proj',
            state: 'ready',
            fleet: {
                orchestrator: { state: 'bound-online', instanceId: 'proj-planner' },
                members: [
                    { instanceId: 'proj-coder-1', role: 'coder', executor: 'first' },
                    { instanceId: 'proj-coder-2', role: 'coder', executor: 'second' },
                ],
            },
        };
        const tree = (path = project.path) =>
            createElement(
                ProjectContext.Provider,
                { value: { ...project, path } as never },
                createElement(ConversationDraftProvider, null, createElement(GlobalAgentBar)),
            );
        const view = render(tree());
        fireEvent.click(view.getByRole('button', { name: 'Open agent prompt bar' }));
        fireEvent.click(view.getByRole('button', { name: /to: auto/ }));
        fireEvent.click(view.getByRole('button', { name: /coder second/ }));
        const box = view.getByRole('textbox', { name: 'Agent prompt' });
        fireEvent.focusIn(box);
        fireEvent.change(box, { target: { value: 'hello second coder' } });
        fireEvent.keyUp(box);
        fireEvent.keyDown(box, { key: 'Enter' });
        await waitFor(() => expect(sent).toHaveLength(1));
        expect(sent[0]?.to).toBe('proj-coder-2');
        expect(sent[0]?.kind).toBeUndefined();
        await waitFor(() => expect(receiptUrls).toHaveLength(1));
        expect(new URL(receiptUrls[0] ?? '').searchParams.get('messageId')).toBe('msg_chat');
        expect(view.container.textContent).toContain('Queued');
        expect(view.container.textContent).not.toContain('No receipt');
        await act(async () => {
            finishReceipt(json([{ messageId: 'msg_chat', status: 'delivered', reason: null, runStatus: 'running' }]));
        });
        await waitFor(() => expect(view.container.textContent).toContain('In progress'));
        const timerIndex = intervals.mock.calls.findLastIndex(([, ms]) => ms === 2000);
        const callback = intervals.mock.calls[timerIndex]?.[0] as () => void;
        const timer = intervals.mock.results[timerIndex]?.value;
        await act(async () => callback());
        await waitFor(() => expect(view.container.textContent).toContain('Delivered'));
        expect(cleared).toHaveBeenCalledWith(timer);
        fireEvent.focusIn(box);
        fireEvent.change(box, { target: { value: 'next active message' } });
        fireEvent.keyUp(box);
        fireEvent.keyDown(box, { key: 'Enter' });
        await waitFor(() => expect(receiptUrls).toHaveLength(3));
        const activeTimer = intervals.mock.results.at(-1)?.value;
        view.rerender(tree('/tmp/other-project'));
        await waitFor(() => expect(cleared).toHaveBeenCalledWith(activeTimer));
        const intervalCount = intervals.mock.calls.length;
        view.unmount();
        expect(intervals.mock.calls).toHaveLength(intervalCount);
    });

    test('run progress and failure take precedence over the successful delivery state', () => {
        expect(receiptStateFor({ status: 'delivered', reason: null, runStatus: 'running' }, false)).toBe('working');
        expect(receiptStateFor({ status: 'delivered', reason: null, runStatus: 'failed' }, false)).toBe('failed');
        expect(receiptStateFor({ status: 'delivered', reason: null, runStatus: 'errored' }, false)).toBe('failed');
        expect(receiptStateFor({ status: 'delivered', reason: null, runStatus: 'completed' }, false)).toBe('delivered');
        expect(receiptStateFor({ status: 'delivered', reason: 'outcome-unknown', runStatus: 'completed' }, false)).toBe(
            'unresolved',
        );
    });
});
