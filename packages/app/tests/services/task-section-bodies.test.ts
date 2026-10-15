import { describe, expect, test } from 'bun:test';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import {
    bulletizeRequirements,
    renderSectionGuidanceBody,
    sectionIsBare,
    stripLeadingSectionHeader,
} from '../../src/services/task-section-bodies';

describe('bulletizeRequirements', () => {
    test('splits a run-on R-numbered paragraph into one bullet per requirement', () => {
        expect(bulletizeRequirements('R1. First. R2. Second.')).toBe('- R1. First.\n- R2. Second.');
    });

    test('leaves empty, single-item, multi-line and already-bulleted input as authored', () => {
        expect(bulletizeRequirements('   ')).toBe('');
        expect(bulletizeRequirements('R1. Only one.')).toBe('R1. Only one.');
        expect(bulletizeRequirements('R1. a\nR2. b')).toBe('R1. a\nR2. b');
        expect(bulletizeRequirements('- R1. a R2. b')).toBe('- R1. a R2. b');
    });
});

describe('stripLeadingSectionHeader', () => {
    test('drops a leading heading that names the section, with the blank lines after it', () => {
        expect(stripLeadingSectionHeader('## Acceptance Criteria\n\n- [ ] AC1', 'acceptance criteria')).toBe(
            '- [ ] AC1',
        );
    });

    test('keeps bodies without a heading or with a different heading', () => {
        expect(stripLeadingSectionHeader('- [ ] AC1', 'Acceptance Criteria')).toBe('- [ ] AC1');
        expect(stripLeadingSectionHeader('### Notes\nx', 'Solution')).toBe('### Notes\nx');
    });
});

describe('sectionIsBare', () => {
    const doc = (body: string) =>
        MarkdownDocument.parse(`---\nschema_version: 1\nname: t\nstatus: wip\n---\n\n## 9999. T\n\n${body}`, 'task');

    test('absent, comment-only and pipeline-placeholder sections are bare; real content is not', () => {
        expect(sectionIsBare(doc(''), 'Solution')).toBe(true);
        expect(sectionIsBare(doc('### Review\n<!-- guidance -->\n'), 'Review')).toBe(true);
        expect(sectionIsBare(doc('### Testing\nPipeline run 0042 — stub\n'), 'Testing')).toBe(true);
        expect(sectionIsBare(doc('### Solution\nReal change map.\n'), 'Solution')).toBe(false);
    });
});

describe('renderSectionGuidanceBody', () => {
    test('wraps a canonical section guidance in a comment; History renders empty', () => {
        expect(renderSectionGuidanceBody('Solution')).toMatch(/^<!-- .+ -->$/);
        expect(renderSectionGuidanceBody('History')).toBe('');
        expect(renderSectionGuidanceBody('Not A Section' as never)).toBe('');
    });
});
