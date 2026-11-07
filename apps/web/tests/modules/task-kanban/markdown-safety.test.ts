import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE = './tests/modules/task-kanban/markdown-safety-pipeline.tsx';
const WEB_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const RUN_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));
const REPORT = join(RUN_ROOT, '.spur', 'run', `markdown-safety-proof-${process.pid}.xml`);
const RESULT = join(RUN_ROOT, '.spur', 'run', `markdown-safety-proof-result-${process.pid}.json`);
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

mkdirSync(join(RUN_ROOT, '.spur', 'run'), { recursive: true });

function readProofReport(path: string): string {
    if (!existsSync(path)) throw new Error(`missing Markdown safety proof report: ${path}`);
    return readFileSync(path, 'utf8');
}

function numberFrom(report: string, attribute: string): number {
    return Number(report.match(new RegExp(`<testsuites[^>]*${attribute}="(\\d+)"`))?.[1] ?? -1);
}

function assertProofReport(report: string): { tests: number; assertions: number } {
    const tests = numberFrom(report, 'tests');
    const failures = numberFrom(report, 'failures');
    const assertions = numberFrom(report, 'assertions');
    const cases = Array.from(report.matchAll(/<testcase name="([^"]+)"/g), (match) => match[1] as string);
    const missing = EXPECTED_PROBES.filter((name) => !cases.includes(name));
    if (tests === 0 || cases.length === 0) throw new Error('Markdown safety proof collected zero cases');
    if (failures !== 0 || missing.length > 0 || assertions <= 0) {
        throw new Error(
            `Markdown safety proof failed: failures=${failures}, assertions=${assertions}, missing=${missing.join(' | ')}`,
        );
    }
    return { tests, assertions };
}

function runMarkdownSafetyProof(
    probe = PROBE,
    reportPath = REPORT,
): { tests: number; assertions: number; report: string } {
    const child = Bun.spawnSync({
        cmd: [
            'bun',
            'test',
            '--preload',
            '../../tests/setup.ts',
            '--isolate',
            '--reporter=junit',
            `--reporter-outfile=${reportPath}`,
            probe,
        ],
        cwd: WEB_ROOT,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
    });
    const output = `${child.stdout.toString()}\n${child.stderr.toString()}`;
    if (child.exitCode !== 0) {
        throw new Error(`Markdown safety child proof exited ${child.exitCode}: ${output.slice(-4000)}`);
    }
    const summary = assertProofReport(readProofReport(REPORT));
    return { ...summary, report: readProofReport(REPORT) };
}

const proof = runMarkdownSafetyProof();
const originalReport = readProofReport(REPORT);
writeFileSync(
    RESULT,
    `${JSON.stringify({ probe: PROBE, report: REPORT, tests: proof.tests, assertions: proof.assertions, failures: 0 }, null, 2)}\n`,
);

test('AC1 — every real-renderer Markdown and Mermaid security proof ran and passed', () => {
    expect({ tests: proof.tests, assertions: proof.assertions > 0 }).toEqual({
        tests: EXPECTED_PROBES.length,
        assertions: true,
    });
    expect(originalReport).toContain('<testsuites');
});

test('missing JUnit evidence fails closed', () => {
    expect(() => readProofReport(join(tmpdir(), 'definitely-missing-markdown-proof.xml'))).toThrow(
        'missing Markdown safety proof report',
    );
});

test('zero collected cases fails closed even when the XML claims zero failures', () => {
    expect(() => assertProofReport('<testsuites tests="0" assertions="0" failures="0"></testsuites>')).toThrow(
        'Markdown safety proof collected zero cases',
    );
});

test('a deliberately failing child fails the parent with the child diagnostic', () => {
    const failingProbe = join(RUN_ROOT, '.spur', 'run', 'deliberate-failing-probe.ts');
    const failingReport = join(RUN_ROOT, '.spur', 'run', 'deliberate-failing-proof.xml');
    writeFileSync(failingProbe, 'console.error("deliberate child failure"); process.exit(7);\n');
    expect(() => runMarkdownSafetyProof(failingProbe, failingReport)).toThrow('deliberate child failure');
});
