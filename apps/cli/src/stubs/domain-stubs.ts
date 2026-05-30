/** Domain subsystem names that intentionally remain stubbed in task 0161. */
export type StubDomain = 'workflow';

/** Descriptive error for domain commands awaiting Phase 3 package extraction. */
export class DomainStubError extends Error {
    constructor(domain: StubDomain, replacementTask: string, packageName: string) {
        super(`${domain} command is stubbed until ${packageName} lands in task ${replacementTask}`);
        this.name = 'DomainStubError';
    }
}

/** Throw the workflow-engine stub replacement error. */
export function throwWorkflowStub(): never {
    throw new DomainStubError('workflow', '0162', '@gobing-ai/ts-dual-workflow-engine');
}
