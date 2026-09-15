import { describe, expect, test } from 'bun:test';
import {
    AgentConfigSchema,
    AgentExecutorConfigSchema,
    AgentFleetSchema,
    FLEET_STRATEGIES,
    FleetMemberSchema,
    featuresConfigSchema,
    HistoryConfigSchema,
    HistoryRefreshConfigSchema,
    misplacedGlobalKeys,
    resolveHistoryRefreshTrigger,
    tasksConfigSchema,
} from '../src/index';

describe('tasksConfigSchema', () => {
    test('parses valid tasks config with a folders map (design §9)', () => {
        const result = tasksConfigSchema.safeParse({
            folders: {
                'docs/tasks': { baseCounter: 0, label: 'Core' },
            },
            active: 'docs/tasks',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.folders['docs/tasks']?.baseCounter).toBe(0);
            expect(result.data.folders['docs/tasks']?.label).toBe('Core');
        }
    });

    test('applies defaults for missing fields', () => {
        const result = tasksConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.active).toBe('docs/tasks');
            expect(result.data.folders).toEqual({});
        }
    });

    test('folder entry baseCounter defaults to 0 when omitted', () => {
        const result = tasksConfigSchema.safeParse({
            folders: { 'docs/tasks': {} },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.folders['docs/tasks']?.baseCounter).toBe(0);
        }
    });
});

describe('featuresConfigSchema', () => {
    test('parses valid features config', () => {
        const result = featuresConfigSchema.safeParse({ dir: 'docs/features' });
        expect(result.success).toBe(true);
    });

    test('applies default dir', () => {
        const result = featuresConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.dir).toBe('docs/features');
        }
    });
});

describe('historyConfigSchema / resolveHistoryRefreshTrigger (task 0549)', () => {
    test('defaults are opt-out: on_completion false, debounce_ms 600000 (0548 figures)', () => {
        const result = HistoryRefreshConfigSchema.parse({});
        expect(result.on_completion).toBe(false);
        expect(result.debounce_ms).toBe(600_000);
    });

    test('explicit opt-in values parse', () => {
        const result = HistoryConfigSchema.safeParse({
            refresh: { on_completion: true, debounce_ms: 300_000 },
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.refresh).toEqual({ on_completion: true, debounce_ms: 300_000 });
        }
    });

    test('debounce_ms below the 1000 ms floor is rejected', () => {
        expect(HistoryRefreshConfigSchema.safeParse({ debounce_ms: 10 }).success).toBe(false);
    });

    test('resolveHistoryRefreshTrigger tolerates null config (trigger disabled by default)', () => {
        expect(resolveHistoryRefreshTrigger(null)).toEqual({
            onCompletion: false,
            debounceMs: 600_000,
        });
    });

    test('the retired schedule_minutes key no longer resolves a trigger (task 0750)', () => {
        // Periodic refresh moved to `bootstrap.scheduler.jobs`. A stale key in an
        // old config must not resurrect a second scheduling path — it is simply
        // not part of the resolved trigger shape any more.
        expect(
            resolveHistoryRefreshTrigger({
                history: { refresh: { on_completion: false, debounce_ms: 600_000, schedule_minutes: 10 } },
            } as never),
        ).toEqual({ onCompletion: false, debounceMs: 600_000 });
    });
});

describe('misplacedGlobalKeys (task 0649 R4)', () => {
    test('returns every project-shaped top-level key present at the global layer', () => {
        expect(
            misplacedGlobalKeys({
                name: 'spur-new',
                bootstrap: { logging: { level: 'info' } },
                rules: { paths: ['.spur/rules/**'] },
                redaction: {},
                tasks: {},
                features: {},
            }),
        ).toEqual(['name', 'bootstrap', 'rules', 'redaction', 'tasks', 'features']);
    });

    test('0857: the retired agent.team key is no longer classified — agent.* stays global-shaped', () => {
        // The key is rejected at load by the loader guard; this classifier no longer
        // owns it, and a leftover block must not read as a second "misplaced" report.
        expect(
            misplacedGlobalKeys({
                agent: {
                    team: { name: 'x' },
                    default: 'coder',
                    executors: [],
                    roles: {},
                },
                workflows: {},
            }),
        ).toEqual([]);
    });

    test('a correctly shaped global config produces no finding (agent.default/executors/roles + workflows)', () => {
        expect(
            misplacedGlobalKeys({
                agent: { default: 'coder', executors: [], roles: {} },
                workflows: { paths: [] },
            }),
        ).toEqual([]);
    });

    test('an empty or global-only config produces no finding', () => {
        expect(misplacedGlobalKeys({})).toEqual([]);
        expect(misplacedGlobalKeys({ workflows: {} })).toEqual([]);
    });
});

// ---- agent.executors disabled flag (0796 R1/R2) ----

describe('AgentExecutorConfigSchema disabled (0796)', () => {
    test('omitted disabled parses to false (post-merge default)', () => {
        const result = AgentExecutorConfigSchema.safeParse({ name: 'omp', agent: 'omp' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.disabled).toBe(false);
        }
    });

    test('explicit true and false parse verbatim', () => {
        expect(AgentExecutorConfigSchema.parse({ name: 'a', agent: 'x', disabled: true }).disabled).toBe(true);
        expect(AgentExecutorConfigSchema.parse({ name: 'a', agent: 'x', disabled: false }).disabled).toBe(false);
    });

    test('non-boolean values are rejected (R2)', () => {
        for (const bad of ['yes', 'true', null, 1, {}]) {
            expect(AgentExecutorConfigSchema.safeParse({ name: 'a', agent: 'x', disabled: bad }).success).toBe(false);
        }
    });
});

describe('AgentFleetSchema (0858 R1/R8)', () => {
    test('R1: defaults — enabled false, strategy rest, members []', () => {
        const fleet = AgentFleetSchema.parse({});
        expect(fleet.enabled).toBe(false);
        expect(fleet.strategy).toBe('rest');
        expect(fleet.members).toEqual([]);
    });

    test('R1: a declared roster parses with its members and orchestrator pointer', () => {
        const fleet = AgentFleetSchema.parse({
            enabled: true,
            strategy: 'gtd',
            orchestrator: 'planner-1',
            members: [
                { role: 'planner', purpose: 'orchestrator' },
                { role: 'coder', executor: 'claude' },
            ],
        });
        expect(fleet.enabled).toBe(true);
        expect(fleet.strategy).toBe('gtd');
        expect(fleet.orchestrator).toBe('planner-1');
        expect(fleet.members).toHaveLength(2);
    });

    test('R1: the strategy vocabulary is the config tuple, not a second union', () => {
        expect(FLEET_STRATEGIES).toEqual(['rest', 'gtd']);
        expect(AgentFleetSchema.safeParse({ strategy: 'round-robin' }).success).toBe(false);
    });

    test('R8: an unknown strategy, a role-less/executor-less member and a non-boolean enabled are ALL reported', () => {
        const result = AgentConfigSchema.safeParse({
            fleet: { enabled: 'yes', strategy: 'round-robin', members: [{ purpose: 'ghost' }] },
        });
        expect(result.success).toBe(false);
        if (result.success) return;
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        // One load error names every issue with its agent.fleet.* path — the member
        // check lives on the entry, so a sibling type error cannot hide it.
        expect(paths).toContain('fleet.enabled');
        expect(paths).toContain('fleet.strategy');
        expect(paths).toContain('fleet.members.0');
        expect(result.error.issues.some((issue) => /must declare a role or an executor/.test(issue.message))).toBe(
            true,
        );
    });

    test('R1: a member declaring neither role nor executor is rejected at any index', () => {
        const result = AgentFleetSchema.safeParse({ members: [{ executor: 'claude' }, { purpose: 'ghost' }] });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('members.1');
        }
    });

    test('FleetMemberSchema itself stays permissive — the rule lives on the entry (0858 R1)', () => {
        expect(FleetMemberSchema.safeParse({ purpose: 'ghost' }).success).toBe(true);
    });
});
