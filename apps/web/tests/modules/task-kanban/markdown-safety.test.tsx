import { afterAll, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Real-renderer pipeline regressions (isolated process) ───────────────────
// The real `@uiw/react-md-editor` renderer cannot be exercised in this process:
// sibling suites register a process-global `mock.module('@uiw/react-md-editor', …)`
// stub and Bun's last registration wins for the whole run, so the renderer here
// would be a passthrough `<div>`. `markdown-safety-pipeline.tsx` is therefore spawned
// as its own `bun test --isolate` process and owns every render; this file owns the
// assertions, and the expected-probe list below fails the suite if the probe silently
// stops running any of them.
const PROBE = './tests/modules/task-kanban/markdown-safety-pipeline.tsx';
const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPORT = join(tmpdir(), `spur-markdown-safety-probe-${process.pid}.xml`);

const probe = Bun.spawnSync({
    cmd: ['bun', 'test', '--isolate', '--reporter=junit', `--reporter-outfile=${REPORT}`, PROBE],
    cwd: WEB_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
});
const probeOutput = `${probe.stdout.toString()}\n${probe.stderr.toString()}`;
const report = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : '';
rmSync(REPORT, { force: true });

const numberFrom = (pattern: RegExp): number => Number(report.match(pattern)?.[1] ?? -1);
const probeTestCount = numberFrom(/<testsuites[^>]*tests="(\d+)"/);
const probeFailureCount = numberFrom(/<testsuites[^>]*failures="(\d+)"/);
const probeAssertionCount = numberFrom(/<testsuites[^>]*assertions="(\d+)"/);
const probeCases = Array.from(report.matchAll(/<testcase name="([^"]+)"/g), (match) => match[1] as string);

const EXPECTED_PROBES = [
    'MarkdownBody read preview emits no dangerous DOM',
    'PlanMarkdownBody read preview emits no dangerous DOM',
    'DesignMarkdownBody read preview emits no dangerous DOM',
    'New Task read preview props render no dangerous DOM',
    'real editor preview pane emits no dangerous DOM',
    'FeatureDetail editor preview pane emits no dangerous DOM',
    'ordinary Markdown renders: headings, bold, safe links, list, table, checkbox',
    'fenced code keeps its language class and literal dangerous-looking text stays inert',
    'plan and design heading anchors stay consistent after sanitization',
    'a mermaid fence still routes to MermaidBlock and its SVG is sanitized',
    'drops executable elements, event handlers and unsafe URLs',
    'preserves ordinary Markdown output: headings, links, code and checkbox inputs',
];

afterAll(() => {
    rmSync(REPORT, { force: true });
});

test('AC1/AC2 — every isolated real-renderer regression ran and passed', () => {
    const missing = EXPECTED_PROBES.filter((name) => !probeCases.includes(name));
    if (probe.exitCode !== 0 || probeFailureCount !== 0 || missing.length > 0) {
        console.error(probeOutput.slice(-4000));
    }
    expect({
        exitCode: probe.exitCode,
        tests: probeTestCount,
        failures: probeFailureCount,
        missing,
        // A probe that stopped rendering would still "pass" with almost no assertions.
        assertionsRan: probeAssertionCount > 100,
    }).toEqual({
        exitCode: 0,
        tests: EXPECTED_PROBES.length,
        failures: 0,
        missing: [],
        assertionsRan: true,
    });
});
