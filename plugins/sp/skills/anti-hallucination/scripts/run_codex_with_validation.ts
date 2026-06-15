#!/usr/bin/env bun

import { runFixedAgentMain } from './acpx_agent_wrapper';

const config = {
    agent: 'codex',
    agentLabel: 'Codex',
    scriptName: 'run_codex_with_validation.ts',
} as const;

export function main(argv = process.argv.slice(2)): number {
    return runFixedAgentMain(config, argv);
}

if (import.meta.main) {
    process.exit(main());
}
