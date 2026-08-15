import { describe, expect, test } from 'bun:test';
import { resolveAutostartSet } from '@gobing-ai/spur-app';
import type { SpurConfig } from '@gobing-ai/spur-config';

// ── resolveAutostartSet (AC5) ──────────────────────────────────────────

describe('resolveAutostartSet (0258 R8/AC5)', () => {
    test('returns empty for a config with no team block', () => {
        const config: SpurConfig = { agent: {} } as SpurConfig;
        expect(resolveAutostartSet(config)).toEqual([]);
    });

    test('returns empty for null config', () => {
        expect(resolveAutostartSet(null)).toEqual([]);
    });

    test('yields members with member.autostart=true', () => {
        const config = {
            agent: {
                team: {
                    alpha: {
                        name: 'Alpha',
                        work_dir: '/tmp',
                        members: [
                            { executor: 'claude', autostart: true },
                            { executor: 'omp', autostart: false },
                        ],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['alpha-claude']);
    });

    test('yields members with team.autostart=true when member has no override', () => {
        const config = {
            agent: {
                team: {
                    beta: {
                        name: 'Beta',
                        work_dir: '/tmp',
                        autostart: true,
                        members: [{ executor: 'claude' }, { executor: 'codex', autostart: false }],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['beta-claude']);
    });

    test('member.autostart overrides team.autostart', () => {
        const config = {
            agent: {
                team: {
                    gamma: {
                        name: 'Gamma',
                        work_dir: '/tmp',
                        autostart: true,
                        members: [{ executor: 'claude', autostart: false }, { executor: 'omp' }],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['gamma-omp']);
    });

    test('SPUR_TEAM_AUTOSTART env unions in', () => {
        const config = {
            agent: {
                team: {
                    alpha: {
                        name: 'Alpha',
                        work_dir: '/tmp',
                        members: [{ executor: 'claude', autostart: true }],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config, 'alpha-omp,delta-codex');
        expect(result).toContain('alpha-claude');
        expect(result).toContain('alpha-omp');
        expect(result).toContain('delta-codex');
    });

    test('uses member.id for composed id when present', () => {
        const config = {
            agent: {
                team: {
                    alpha: {
                        name: 'Alpha',
                        work_dir: '/tmp',
                        members: [{ executor: 'claude', id: 'reviewer', autostart: true }],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['alpha-reviewer']);
    });

    test('0543 R3: a role-only member derives <role>-<n> for the composed id', () => {
        const config = {
            agent: {
                team: {
                    alpha: {
                        name: 'Alpha',
                        work_dir: '/tmp',
                        members: [
                            { role: 'coder', autostart: true },
                            { role: 'coder', autostart: true },
                        ],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['alpha-coder-1', 'alpha-coder-2']);
    });

    test('returns sorted results', () => {
        const config = {
            agent: {
                team: {
                    zeta: {
                        name: 'Zeta',
                        work_dir: '/tmp',
                        members: [{ executor: 'b', autostart: true }],
                    },
                    alpha: {
                        name: 'Alpha',
                        work_dir: '/tmp',
                        members: [{ executor: 'a', autostart: true }],
                    },
                },
            },
        } as unknown as SpurConfig;
        const result = resolveAutostartSet(config);
        expect(result).toEqual(['alpha-a', 'zeta-b']);
    });
});
