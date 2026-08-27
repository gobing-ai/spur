import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mainCli, runValidateCli, validateReport } from '../../scripts/dogfood-testing/validate-report';

const SKILL_DIR = join(import.meta.dir, '..', '..', 'skills', 'dogfood-testing');
const FIXTURES = join(import.meta.dir, 'fixtures');

const passFixture = readFileSync(join(FIXTURES, 'report-complete.md'), 'utf8');
const failFixture = readFileSync(join(FIXTURES, 'report-missing-footer.md'), 'utf8');

describe('dogfood @1.2 report contract (task 0276)', () => {
    test('dogfood-fixture-pass — report-complete.md validates clean', () => {
        const result = validateReport(passFixture);
        expect(result.errors).toEqual([]);
        expect(result.ok).toBe(true);

        // Golden-shape assertions (0274 R22b) — the fixture is the SSOT example.
        expect(passFixture).toContain('── Dogfood Summary ──');
        expect(passFixture).toContain('[Live:');
        expect(passFixture).toContain('[Report:');
        for (const n of [1, 2, 3, 4, 5, 6]) {
            const re = new RegExp(`^### ${n}\\.`, 'gm');
            expect(passFixture.match(re)).toHaveLength(1);
        }
        expect(passFixture).toContain('#### Fixed');
        expect(passFixture).toContain('#### Unresolved');
        expect(passFixture).toContain('protocol: sp:dogfood-testing@1.2');
    });

    test('dogfood-fixture-fail-footer — missing footer is rejected with missing_footer', () => {
        const result = validateReport(failFixture);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_footer');
        expect(result.errors).toContain('missing_live_path');
        expect(result.errors).toContain('missing_report_path');
    });

    test('dogfood-protocol-string — skill surfaces pin the colon-form @1.2 protocol', () => {
        for (const rel of ['SKILL.md', 'references/report-template.md', 'references/monitor-ledger.md']) {
            const text = readFileSync(join(SKILL_DIR, rel), 'utf8');
            expect(text, `${rel} must carry the @1.2 protocol string`).toContain('sp:dogfood-testing@1.2');
            expect(text, `${rel} must not document the dash form as canonical`).not.toContain(
                'protocol: sp-dogfood-testing@',
            );
        }
        const skill = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');
        expect(skill).toContain('version: "1.2"');
        expect(skill).toContain('protocol: "sp:dogfood-testing@1.2"');
    });

    test('validator — duplicated section heading is rejected', () => {
        const mutated = passFixture.replace('### 6. Findings', '### 6. Findings\n\n### 6. Findings (duplicate)');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('duplicate_section:6');
    });

    test('validator — dropped section heading is rejected', () => {
        const mutated = passFixture.replace('### 4. What We Did', '### What We Did');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_section:4');
    });

    test('validator — missing Issues subheads are rejected', () => {
        const mutated = passFixture.replace('#### Unresolved', '#### Open');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_issues_subheads');
    });

    test('validator — ledger row count must equal declared executed steps', () => {
        const mutated = passFixture.replace('**Steps:** 2 derived, 2 executed', '**Steps:** 3 derived, 3 executed');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('ledger_cardinality');
    });

    test('validator — drift:external rows do not count toward executed steps (task 0296)', () => {
        const driftRow = '| drift:external | — | drift | src/x.ts | P2 — workspace drift | — | — | — | hash diff | — |';
        const mutated = passFixture.replace(
            '| 2 execute | 1 | PASS | — | — | ~800 | ~300 | 27% | command output + prior plan reused | ~5s |',
            `| 2 execute | 1 | PASS | — | — | ~800 | ~300 | 27% | command output + prior plan reused | ~5s |\n${driftRow}`,
        );
        const result = validateReport(mutated);
        expect(result.ok).toBe(true);
    });

    test('validator — missing ledger section with declared steps is a cardinality failure', () => {
        const mutated = passFixture.replace(/### 3\. Monitor Ledger[\s\S]*?(?=### 4\.)/, '');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('ledger_cardinality');
    });

    test('validator — undeclared Steps line is rejected', () => {
        const mutated = passFixture.replace('- **Steps:** 2 derived, 2 executed, 0 N/A', '- **Steps:** (not recorded)');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_steps_declared');
    });

    test('validator — dash-form protocol string is rejected', () => {
        const mutated = passFixture.replace('protocol: sp:dogfood-testing@1.2', 'protocol: sp-dogfood-testing@1.2');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('protocol_string');
    });

    test('validator — missing protocol frontmatter line is rejected', () => {
        const mutated = passFixture.replace('protocol: sp:dogfood-testing@1.2\n', '');
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('protocol_string');
    });

    test('validator — missing [Live:] delivery path is rejected', () => {
        const mutated = passFixture.replace(
            '[Live: .spur/run/dogfood/fixture-complete-0001.md]',
            '(live path omitted)',
        );
        const result = validateReport(mutated);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_live_path');
    });

    test('validator — non-@1.2 §-style report (refine dogfood hole) fails structure', () => {
        // Reproduces 0277 refine dogfood shape: ## §1…## §7 without ### 1.–### 6. / footer.
        const sectionStyle = [
            '---',
            'protocol: sp:dogfood-testing@1.2',
            '---',
            '## §1 Summary',
            '## §2 Protocol Artifacts',
            '## §3 Derived Steps',
            '## §4 Execution Ledger',
            '## §5 Findings',
            '## §6 Cost',
            '## §7 Finalize',
        ].join('\n');
        const result = validateReport(sectionStyle);
        expect(result.ok).toBe(false);
        expect(result.errors).toContain('missing_footer');
        expect(result.errors.some((e) => e.startsWith('missing_section:'))).toBe(true);
    });

    test('validate CLI — pass fixture exits 0; §-style exits 2 (task 0278 R6)', () => {
        const files = new Map<string, string>([
            ['pass.md', passFixture],
            ['bad.md', '## §1 Summary\nprotocol: sp:dogfood-testing@1.2\n'],
        ]);
        const read = (p: string) => {
            const v = files.get(p);
            if (v === undefined) throw new Error(`missing ${p}`);
            return v;
        };
        const ok = runValidateCli(['--file', 'pass.md'], read);
        expect(ok.exitCode).toBe(0);
        expect(ok.stdout.trim()).toBe('ok');

        const badJson = runValidateCli(['--file', 'bad.md', '--json'], read);
        expect(badJson.exitCode).toBe(2);
        const parsed = JSON.parse(badJson.stdout) as { ok: boolean; errors: string[] };
        expect(parsed.ok).toBe(false);
        expect(parsed.errors.length).toBeGreaterThan(0);

        const badPlain = runValidateCli(['bad.md'], read);
        expect(badPlain.exitCode).toBe(2);
        expect(badPlain.stdout).toContain('missing_footer');

        const help = runValidateCli(['--help'], read);
        expect(help.exitCode).toBe(0);
        expect(help.stderr).toContain('Usage:');

        const usage = runValidateCli([], read);
        expect(usage.exitCode).toBe(1);
        expect(usage.stderr).toContain('Usage:');

        const missing = runValidateCli(['--file', 'nope.md'], read);
        expect(missing.exitCode).toBe(1);
        expect(missing.stderr).toContain('Failed to read');

        // mainCli uses real fs and real stdout — capture the write so the
        // success banner ('ok') doesn't leak into the test reporter output.
        const origWrite = process.stdout.write;
        let captured = '';
        process.stdout.write = ((chunk: unknown) => {
            captured += String(chunk);
            return true;
        }) as typeof process.stdout.write;
        try {
            const realExit = mainCli(['--file', join(FIXTURES, 'report-complete.md')]);
            expect(realExit).toBe(0);
            expect(captured.trim()).toBe('ok');
        } finally {
            process.stdout.write = origWrite;
        }
    });
});

describe('environment-lens class tags (task 0686, R3-R5/R14)', () => {
    // §6 Findings is "(none)" in the shared fixture — inject a finding line per case.
    const inject = (line: string): string =>
        passFixture.replace('### 6. Findings\n\n(none)', `### 6. Findings\n\n${line}\n\n(none)`);
    const tagged = (cls: string | null): string => {
        const tag = cls ? `[${cls}] ` : '';
        return `- **P3** — ${tag}Pinned agent config drift left the doc path ambiguous. → **Action:** add a see_also pointer. (\`docs/x.md:10\`, ~5m) \`[feasible]\``;
    };

    test('environment / testee / waste tags all validate under the unchanged @1.2 protocol', () => {
        for (const cls of ['environment', 'testee', 'waste']) {
            const result = validateReport(inject(tagged(cls)));
            expect(result.ok).toBe(true);
        }
    });

    test('class position is after the em dash and distinct from the trailing feasibility tag', () => {
        const line = inject(tagged('environment'));
        expect(line).toContain('— [environment] ');
        expect(line.indexOf('[environment]')).toBeLessThan(line.indexOf('[feasible]'));
    });

    test('an untagged finding still validates — omitting the class preserves the @1.2 line shape', () => {
        expect(validateReport(inject(tagged(null))).ok).toBe(true);
    });

    test('a report with no findings still validates — no new required field exists', () => {
        expect(validateReport(passFixture).ok).toBe(true);
    });

    // R14: the pre-existing cache-health P3 (aggregate cache% < 50 or a step < 40) predates the
    // class tags and must keep validating without one — the tags add no required field.
    test('the untagged cache-health P3 still validates under @1.2 (R14)', () => {
        const cacheHealth =
            '- **P3** — Low cache hit rate — candidate for context-window or prompt trimming ' +
            '(aggregate 38%, step `implement` 22%). → **Action:** trim the always-loaded preamble. ' +
            '(`plugins/sp/skills/dogfood-testing/SKILL.md:1`, ~15m) `[unverifiable]`';
        expect(cacheHealth).not.toContain('[environment]');
        expect(cacheHealth).not.toContain('[waste]');
        expect(validateReport(inject(cacheHealth)).ok).toBe(true);
    });
});
