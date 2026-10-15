import type { Command } from '@commander-js/extra-typings';
import type { AgentLoopRuntime, AgentRunDeps } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { registerAgentDoctorCommand } from './doctor';
import { registerAgentJoinCommand } from './join';
import { registerAgentLeaveCommand } from './leave';
import { registerAgentListCommand } from './list';
import { registerAgentLoopCommand } from './loop';
import { registerAgentReportCommand } from './report';
import { registerAgentRunCommand } from './run';
import { registerAgentStartCommand } from './start';
import { registerAgentStatusCommand } from './status';
import { registerAgentStopCommand } from './stop';
import { registerAgentTraceCommand } from './trace';
import { registerAgentUsageCommand } from './usage';
import { registerAgentWaitCommand } from './wait';

export type { AgentLoopRuntime, AgentRunDeps };

// ── Member session re-exports (task 0967, ADR-021) ─────────────────────────────

export type {
    MemberAgentProcess,
    MemberSessionDeps,
    MemberSessionMode,
    MemberSessionResetReason,
} from '@gobing-ai/spur-app';

// The G66 member-session mechanics (mode resolution, process lifecycle, reset
// ledger, failed-drain budget) now live in `@gobing-ai/spur-app`
// (`packages/app/src/services/member-session.ts`). These names stay re-exported
// from this module so imports from the base revision keep resolving.
export { MAX_CONSECUTIVE_FAILED_DRAINS, MemberSession, selectsPersistentStdinDispatch } from '@gobing-ai/spur-app';

/** Register `spur agent` commands on the CLI program. */
export function registerAgentCommand(program: Command, context: CliContext): void {
    const agent = program.command('agent').summary('run and inspect supported coding agents');
    registerAgentListCommand(agent, context);
    registerAgentStatusCommand(agent, context);
    registerAgentUsageCommand(agent, context);
    registerAgentDoctorCommand(agent, context);
    registerAgentReportCommand(agent, context);
    registerAgentRunCommand(agent, context);
    registerAgentLoopCommand(agent, context);
    registerAgentJoinCommand(agent, context);
    registerAgentLeaveCommand(agent, context);
    registerAgentWaitCommand(agent, context);
    registerAgentTraceCommand(agent, context);
    registerAgentStartCommand(agent, context);
    registerAgentStopCommand(agent, context);
}

export { runAgentJoin } from './join';
export { runAgentLeave } from './leave';
export { startParentWatch } from './loop';
export { runAgentReport } from './report';
export { refuseGuestStageTarget, runAgentRun, validateAgentSelector } from './run';
export type { AgentServerResolveDeps, FleetProcessStatus } from './shared';
export {
    ancestorDirs,
    DEFAULT_TRACE_FOLLOW_TIMEOUT_MS,
    resetAgentServerFetchForTesting,
    resolveAgentServer,
    runAgentLoop,
    setAgentServerFetchForTesting,
    settleClaimedMessages,
} from './shared';
export type { AgentUsageDeps } from './usage';
export { resetAgentUsageSourceForTesting, runAgentUsage, setAgentUsageSourceForTesting } from './usage';
export { runAgentWaitInbox } from './wait';
