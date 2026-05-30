import type { CliContext } from '../context';
import { throwHistoryStub, throwWorkflowStub } from '../stubs/domain-stubs';

/** Execute the workflow command stub until task 0162 lands. */
export function runWorkflowCommand(_context: CliContext): never {
    throwWorkflowStub();
}

/** Execute the history command stub until tasks 0160/0157 land. */
export function runHistoryCommand(_context: CliContext): never {
    throwHistoryStub();
}
