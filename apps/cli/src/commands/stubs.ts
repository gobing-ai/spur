import type { CliContext } from '../context';
import { throwWorkflowStub } from '../stubs/domain-stubs';

/** Execute the workflow command stub until task 0162 lands. */
export function runWorkflowCommand(_context: CliContext): never {
    throwWorkflowStub();
}
