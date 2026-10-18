import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMigratedDb, type DbAdapter } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';

export const HOST_FLOW = `name: host-executor-flow
kind: state-machine
initialState: work
states:
  - id: work
    onEnter:
      - kind: agent.run
        options:
          role: coder
          input: "Write .spur/run/host-artifact.txt"
          expectFile: .spur/run/host-artifact.txt
          ownedSections: [Solution]
          inputs:
            - path: docs/tasks5/1232_task.md
              kind: task
  - id: review
    onEnter:
      - kind: agent.run
        options:
          role: reviewer
          input: "Review .spur/run/host-artifact.txt"
          expectFile: .spur/run/host-review.txt
  - id: done
transitions:
  - from: work
    to: review
    guard: { kind: always }
  - from: review
    to: done
    guard: { kind: always }
terminalStates: [done]
`;

const TASK_BODY = '### Solution\n\nImplemented in receipt.ts.\n';

export interface Harness {
    svc: WorkflowAppService;
    dir: string;
    db: DbAdapter;
    file: string;
}

export async function harness(onInvoke?: (signal?: AbortSignal) => Promise<void>): Promise<Harness> {
    const dir = mkdtempSync(join(tmpdir(), 'spur-host-executor-'));
    const wfDir = join(dir, '.spur', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const file = join(wfDir, 'host-executor-flow.yaml');
    writeFileSync(file, HOST_FLOW, 'utf8');
    mkdirSync(join(dir, 'docs', 'tasks5'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'tasks5', '1232_task.md'), TASK_BODY, 'utf8');

    const db = await createMigratedDb({ url: ':memory:' });
    // The fake executor writes the artifacts the fixture stages declare, the way a real one would.
    const produceArtifacts = (): void => {
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        writeArtifact(dir, '.spur/run/host-review.txt');
    };
    const svc = new WorkflowAppService({
        cwd: dir,
        getDb: async () => db,
        agentService: () =>
            ({
                runTraced: async (
                    _input: unknown,
                    _flags: unknown,
                    _deps: unknown,
                    trace?: { signal?: AbortSignal },
                ) => {
                    await onInvoke?.(trace?.signal);
                    produceArtifacts();
                    return {
                        exitCode: 0,
                        stdout: '',
                        invocation: {
                            agent: 'claude',
                            source: 'default',
                            command: 'claude',
                            argv: ['-p', 'x'],
                            cwd: dir,
                            mode: 'text',
                            outputMode: 'buffered',
                            continue: false,
                            stdinInteractive: false,
                        },
                    };
                },
            }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    });
    return { svc, dir, db, file };
}

/** Write the receipt a host session would produce for a paused stage. */
export function writeHostReceipt(
    dir: string,
    receipt: {
        runId: string;
        state: string;
        outcome?: string;
        files?: string[];
    },
): string {
    const target = join(dir, '.spur', 'run', 'host-receipt.json');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
        target,
        JSON.stringify({
            runId: receipt.runId,
            state: receipt.state,
            executor: 'host',
            outcome: receipt.outcome ?? 'done',
            startedAt: '2026-10-17T10:00:00.000Z',
            finishedAt: '2026-10-17T10:05:00.000Z',
            files: receipt.files ?? [],
            reason: null,
        }),
        'utf8',
    );
    return target;
}

export function writeArtifact(dir: string, path: string): void {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'produced by the host', 'utf8');
}
