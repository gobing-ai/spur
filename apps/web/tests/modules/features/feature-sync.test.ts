registerHappyDom();

import { afterAll, afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import FeatureDetail from '../../../src/modules/features/FeatureDetail';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import '../../test-helpers/rpc-client-mock';

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

test('feature sync defaults to supported pull, disables push, and preserves an unsaved draft', async () => {
    const syncRequests: unknown[] = [];
    let reads = 0;
    setFetchForTesting((async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        const isSync = new URL(request.url).pathname.endsWith('/sync');
        if (isSync) syncRequests.push(await request.json());
        else reads++;
        return Response.json({
            ok: true,
            data: isSync
                ? { direction: 'pull', affectedTasks: 1, applied: true, newStatus: 'active' }
                : {
                      id: 'F1',
                      name: 'Sync fixture',
                      status: 'active',
                      frontmatter: {},
                      filePath: 'docs/features/F1_sync.md',
                      content: 'Feature body',
                  },
        });
    }) as typeof fetch);

    const view = render(createElement(FeatureDetail, { featureId: 'F1' }));
    const sync = await view.findByRole('button', { name: 'Sync' });
    fireEvent.click(view.getByLabelText('Edit body'));
    const editor = within(view.getByTestId('body-editor')).getByRole('textbox') as HTMLTextAreaElement;
    const reactPropsKey = Object.keys(editor).find((key) => key.startsWith('__reactProps'));
    if (!reactPropsKey) throw new Error('missing MDEditor React props');
    const reactProps = Reflect.get(editor, reactPropsKey) as {
        onChange: (event: { target: { value: string } }) => void;
    };
    // Drive the real MDEditor handler so the controlled draft changes without mocking the renderer.
    await act(async () => {
        reactProps.onChange({ target: { value: 'Unsaved feature draft' } });
    });
    await waitFor(() => expect(editor.value).toBe('Unsaved feature draft'));
    fireEvent.click(sync);
    const dialog = view.getByRole('dialog', { name: 'Configure sync-status action' });
    const direction = within(dialog).getByRole('combobox') as HTMLSelectElement;
    expect(direction.value).toBe('pull');
    expect((within(dialog).getByRole('option', { name: /Push/ }) as HTMLOptionElement).disabled).toBe(true);
    const readsBeforeSync = reads;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));

    await waitFor(() => expect(syncRequests).toEqual([{ id: 'F1', direction: 'pull' }]));
    await view.findByText('Sync applied: status is now active.');
    expect(reads).toBeGreaterThan(readsBeforeSync);
    expect(view.queryByRole('dialog')).toBeNull();
    expect((within(view.getByTestId('body-editor')).getByRole('textbox') as HTMLTextAreaElement).value).toBe(
        'Unsaved feature draft',
    );
});

test('feature action dialog omits the unsupported dependency control', async () => {
    setFetchForTesting((async () =>
        Response.json({
            ok: true,
            data: {
                id: 'F2',
                name: 'Action fixture',
                status: 'backlog',
                frontmatter: {},
                filePath: 'docs/features/F2_action.md',
                content: 'Feature body',
            },
        })) as unknown as typeof fetch);

    const view = render(createElement(FeatureDetail, { featureId: 'F2' }));
    fireEvent.click(await view.findByRole('button', { name: 'Plan' }));
    const dialog = view.getByRole('dialog', { name: 'Configure plan action' });

    expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('claude');
    expect(within(dialog).queryByText('Skip dependencies')).toBeNull();
});
