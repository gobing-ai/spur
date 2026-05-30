import type { CliContext } from '../context';
import { throwAgentStub, throwHistoryStub, throwRuleStub, throwWorkflowStub } from '../stubs/domain-stubs';

/** Execute the rule command stub until task 0158 lands. */
export function runRuleCommand(_context: CliContext): never {
    throwRuleStub();
}

/** Execute the workflow command stub until task 0162 lands. */
export function runWorkflowCommand(_context: CliContext): never {
    throwWorkflowStub();
}

/** Execute the agent command stub until task 0158 lands. */
export function runAgentCommand(_context: CliContext): never {
    throwAgentStub();
}

/** Execute the history command stub until tasks 0160/0157 land. */
export function runHistoryCommand(_context: CliContext): never {
    throwHistoryStub();
}
