/**
 * 0777 R4 (F4): run-start capability preflight. A workflow whose agent.run step
 * pins an executor with requiresCapabilities that its attestation cannot satisfy
 * must warn on stderr before any dispatch — advisory only; the fail-closed
 * pre-spawn gate (0706 R5) still refuses the run.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { main } from '../../src/index';
import { createCapturedOutput, createTempProject } from '../helpers';

const PINNED_WORKFLOW_YAML = `name: preflight-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: agent.run
        options:
          agent: attested-exec
          prompt: hi
          requiresCapabilities:
            fsWrite: available
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

const PINNED_TRANSITION_FLOW_YAML = `name: preflight-flow-tf
kind: transition-flow
initialNode: a
nodes:
  - id: a
    action:
      kind: agent.run
      options:
        agent: attested-exec
        prompt: hi
        requiresCapabilities:
          fsWrite: available
  - id: b
edges:
  - from: a
    to: b
`;

const ATTESTED_CONFIG_YAML = `agent:
  executors:
    - name: attested-exec
      agent: echo-agent
      executionCapabilities:
        axes:
          fsWrite:
            state: enforced
            provenance: operator-configured
`;

describe('workflow run capability preflight (0777 R4)', () => {
    test('warns naming the executor and missing axis when the pin is unattested', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await Bun.write(workflowFile, PINNED_WORKFLOW_YAML);
        const output = createCapturedOutput();
        try {
            // No executors entry → every axis unknown/unattested → fsWrite: available unsatisfied.
            await main(['workflow', 'run', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
            const stderr = output.errors.join('\n');
            expect(stderr).toContain('capability preflight (0777 R4)');
            expect(stderr).toContain("'attested-exec'");
            expect(stderr).toContain('fsWrite');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('walks transition-flow nodes too (unattested pin warns)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await Bun.write(workflowFile, PINNED_TRANSITION_FLOW_YAML);
        const output = createCapturedOutput();
        try {
            await main(['workflow', 'run', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
            const stderr = output.errors.join('\n');
            expect(stderr).toContain('capability preflight (0777 R4)');
            expect(stderr).toContain("'attested-exec'");
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('stays silent when the pinned executor attests the required axis', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await Bun.write(workflowFile, PINNED_WORKFLOW_YAML);
        await mkdir(join(dir, '.spur'), { recursive: true });
        await Bun.write(join(dir, '.spur', 'config.yaml'), ATTESTED_CONFIG_YAML);
        const output = createCapturedOutput();
        try {
            // Dispatch itself fails fast (echo-agent is not a canonical agent);
            // the assertion is only that the preflight produced no warning.
            await main(['workflow', 'run', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
            expect(output.errors.join('\n')).not.toContain('capability preflight');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
