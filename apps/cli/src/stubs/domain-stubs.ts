/** Domain subsystem names that intentionally remain stubbed in task 0161. */
export type StubDomain = 'rule' | 'workflow' | 'agent' | 'history';

/** Descriptive error for domain commands awaiting Phase 3 package extraction. */
export class DomainStubError extends Error {
    constructor(domain: StubDomain, replacementTask: string, packageName: string) {
        super(`${domain} command is stubbed until ${packageName} lands in task ${replacementTask}`);
        this.name = 'DomainStubError';
    }
}

/** Throw the rule-engine stub replacement error. */
export function throwRuleStub(): never {
    throw new DomainStubError('rule', '0158', '@gobing-ai/ts-rule-engine');
}

/** Throw the workflow-engine stub replacement error. */
export function throwWorkflowStub(): never {
    throw new DomainStubError('workflow', '0162', '@gobing-ai/ts-dual-workflow-engine');
}

/** Throw the agent-runner stub replacement error. */
export function throwAgentStub(): never {
    throw new DomainStubError('agent', '0158', '@gobing-ai/ts-ai-runner');
}

/** Throw the history subsystem stub replacement error. */
export function throwHistoryStub(): never {
    throw new DomainStubError('history', '0160/0157', '@gobing-ai/ts-llm-jsonl-importer + ts-data-pipeline');
}
