/**
 * Thin-wrapper tests for `writeStepText` (apps/cli/src/commands/task/step-output.ts): the byte-exact writer the absorbed
 * pipeline steps print through (script-absorption PR-5).
 */
import { describe, expect, test } from 'bun:test';
import { writeStepText } from '../../../src/commands/task/step-output';
import { createCapturedOutput } from '../../helpers';

describe('writeStepText', () => {
    test('drops one trailing newline, routes by stream, and writes nothing for empty text', () => {
        const output = createCapturedOutput();
        writeStepText(output, 'stdout', 'a\n\n');
        writeStepText(output, 'stderr', 'b');
        writeStepText(output, 'stdout', '');
        expect(output.messages).toEqual(['a\n']);
        expect(output.errors).toEqual(['b']);
    });
});
