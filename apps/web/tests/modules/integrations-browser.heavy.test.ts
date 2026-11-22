import { expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runIntegrationsE2e } from '../../../../scripts/commands/integrations-e2e';
import { buildBoardToTemp, removeBoardBuild, WEB_ROOT } from '../test-helpers/board-build';
import { availableBrowserBinary, launchBrowser } from '../test-helpers/cdp';

const reports = join(WEB_ROOT, '../../docs/reports');

test.skipIf(availableBrowserBinary() === undefined)(
    'A82 live protocol and Board proof writes a receipt and both screenshots',
    async () => {
        const build = await buildBoardToTemp();
        try {
            const code = await runIntegrationsE2e([], {
                webDistPath: build,
                verifyBoard: async (root) => {
                    const browser = await launchBrowser();
                    try {
                        const page = await browser.newPage();
                        await browser.navigate(`${root}/board/integrations`, page);
                        await browser
                            .waitFor('Boolean(document.querySelector("[data-testid=integrations-summary-table]"))', {
                                sessionId: page,
                                label: 'live Integrations summary',
                                timeoutMs: 30_000,
                            })
                            .catch(async (error) => {
                                const pageText = await browser.evaluate<string>(
                                    'document.body.innerText.slice(-2000)',
                                    { sessionId: page },
                                );
                                throw new Error(`Live Board failed to render: ${pageText}`, { cause: error });
                            });
                        const rows = await browser.evaluate<string[]>(
                            'Array.from(document.querySelectorAll("[data-testid^=integrations-row-]"), (row) => row.getAttribute("data-testid"))',
                            { sessionId: page },
                        );
                        expect(rows.sort()).toEqual([
                            'integrations-row-a2a-inbound',
                            'integrations-row-a2a-outbound',
                            'integrations-row-gateway-mcp',
                            'integrations-row-project-mcp',
                        ]);
                        const states = await browser.evaluate<string[]>(
                            '["project-mcp","a2a-inbound"].map((name) => document.querySelector("[data-testid=integrations-row-" + name + "] td:nth-child(2)").textContent)',
                            { sessionId: page },
                        );
                        expect(states).toEqual(['on · token unset', 'on']);
                        const error = await browser.evaluate<boolean>(
                            'Boolean(document.querySelector("[data-testid=integrations-row-project-mcp] .badge-error"))',
                            { sessionId: page },
                        );
                        expect(error).toBe(true);
                        for (const theme of ['light', 'dark']) {
                            await browser.evaluate(`document.documentElement.setAttribute('data-theme', '${theme}')`, {
                                sessionId: page,
                            });
                            const capture = (await browser.send('Page.captureScreenshot', { format: 'png' }, page)) as {
                                data: string;
                            };
                            writeFileSync(
                                join(reports, `integrations-e2e-summary-${theme}.png`),
                                Buffer.from(capture.data, 'base64'),
                            );
                        }
                        return 'four Summary surfaces; MCP token unset is an error and authenticated A2A is on';
                    } finally {
                        await browser.close();
                    }
                },
            });
            expect(code).toBe(0);
            const receipt = JSON.parse(readFileSync(join(reports, 'integrations-e2e-receipt.json'), 'utf8')) as {
                verdict: string;
                steps: Array<{ step: string; status: string }>;
            };
            expect(receipt.verdict).toBe('PASS');
            expect(receipt.steps).toContainEqual(
                expect.objectContaining({ step: 'integrations-board', status: 'passed' }),
            );
        } finally {
            await removeBoardBuild(build);
        }
    },
    600_000,
);
