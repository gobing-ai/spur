import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runIntegrationsE2e } from '../../../../scripts/commands/integrations-e2e';
import { buildBoardToTemp, removeBoardBuild, WEB_ROOT } from '../test-helpers/board-build';
import { availableBrowserBinary, launchBrowser } from '../test-helpers/cdp';

const reports = join(WEB_ROOT, '../../.spur/run/integrations-proof');

test.skipIf(availableBrowserBinary() === undefined)(
    'A82 live protocol and Board proof writes a receipt and both screenshots',
    async () => {
        const build = await buildBoardToTemp();
        mkdirSync(reports, { recursive: true });
        try {
            const code = await runIntegrationsE2e([], {
                webDistPath: build,
                receiptPath: join(reports, 'integrations-e2e-receipt.json'),
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
                        // Task 1437 R6: the live page must name the served build, so a stale server is visible.
                        const runtime = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-server-runtime]").textContent',
                            { sessionId: page },
                        );
                        expect(runtime).toMatch(/^server v\d+\.\d+\.\d+ · up /);
                        // 1439 R1: the live window is populated by this run's own MCP calls, so the
                        // tool-latency slice must show them rather than an empty state.
                        const usageTools = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-usage-tools]")?.textContent ?? ""',
                            { sessionId: page },
                        );
                        expect(usageTools).toContain('sp_task_list');
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
                        // 1438 R2: the MCP tab names the namespace, keeps the refused exposure's
                        // remedy visible, and offers a project command that names no token value.
                        await browser.evaluate('document.querySelector("#integrations-tab-mcp").click()', {
                            sessionId: page,
                        });
                        await browser.waitFor(
                            'Boolean(document.querySelector("[data-testid=integrations-mcp-tools]"))',
                            { sessionId: page, label: 'live Integrations MCP tab', timeoutMs: 30_000 },
                        );
                        const namespace = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-mcp-namespace]")?.textContent ?? ""',
                            { sessionId: page },
                        );
                        expect(namespace).toContain('e2e');
                        const exposure = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-mcp-exposure]")?.textContent ?? ""',
                            { sessionId: page },
                        );
                        expect(exposure).toContain('duplicate');
                        const command = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-mcp-project-command]")?.textContent ?? ""',
                            { sessionId: page },
                        );
                        expect(command).toContain('spur mcp --url');
                        // 1440 R1: the A2A card inspector fetches the live public card on demand and
                        // renders it as text; the live listener has one member, so no warning shows.
                        await browser.evaluate('document.querySelector("#integrations-tab-a2a").click()', {
                            sessionId: page,
                        });
                        await browser.waitFor(
                            'Boolean(document.querySelector("[data-testid=integrations-a2a-members]"))',
                            { sessionId: page, label: 'live Integrations A2A tab', timeoutMs: 30_000 },
                        );
                        expect(
                            await browser.evaluate<boolean>(
                                'Boolean(document.querySelector("[data-testid=integrations-a2a-no-inbound]"))',
                                { sessionId: page },
                            ),
                        ).toBe(false);
                        await browser.evaluate(
                            'document.querySelector("[data-testid=integrations-a2a-card-load]").click()',
                            { sessionId: page },
                        );
                        await browser.waitFor(
                            'Boolean(document.querySelector("[data-testid=integrations-a2a-card-json]"))',
                            { sessionId: page, label: 'live Agent Card JSON', timeoutMs: 30_000 },
                        );
                        const cardJson = await browser.evaluate<string>(
                            'document.querySelector("[data-testid=integrations-a2a-card-json]").textContent',
                            { sessionId: page },
                        );
                        expect(cardJson).toContain('"name"');
                        const examples = await browser.evaluate<string>(
                            'document.querySelector("[data-testid^=integrations-a2a-examples-]").textContent',
                            { sessionId: page },
                        );
                        expect(examples).toContain('a2a card get -o json');
                        return "four Summary surfaces; MCP token unset is an error and authenticated A2A is on; the served build version and uptime are named; the selected window's tool latency lists this run's own calls; the MCP tab names the workflow namespace and the refused exposure";
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
