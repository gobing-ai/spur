registerHappyDom();

import { afterAll, afterEach, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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

test('feature sync defaults to supported pull, disables push, and reloads after dispatch', async () => {
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
});
