/**
 * SDLC action resolver (feature A92, ADR-139, design `docs/design/sdlc-actions.md` §3.1–3.2).
 *
 * One pure table-driven resolver shared by the `spur self exec` verb (1223) and the quality
 * gate (1224), so the bun literals live here once instead of inside the engine. Resolution for
 * action `a`: `builder.actions[a]` → active-preset entry → stack-neutral default → unbound.
 * A declared entry replaces a preset entry whole — never merged.
 */
import { type BuilderConfig, SDLC_ACTIONS, SDLC_STACK_NEUTRAL_ACTIONS, type SdlcAction } from '@gobing-ai/spur-config';
import { shQuote } from './shell-quote';

/** The closed reserved action vocabulary, in frozen order (SSOT: `packages/config`). */
export const RESERVED_ACTIONS: readonly ReservedAction[] = SDLC_ACTIONS;

/** One reserved action name. */
export type ReservedAction = SdlcAction;

/**
 * The `bun` preset bindings — today's exact commands (satellite §3.1 bun column), so an
 * existing bun project resolves every reserved action with no config edit (R4).
 */
export const BUN_PRESET: Readonly<Record<ReservedAction, string>> = {
    build: 'bun run build',
    dev: 'bun run dev',
    clean: 'bun run clean',
    format: 'bun run format',
    autofix: 'bun run autofix',
    lint: 'bun run lint',
    typecheck: 'bun run typecheck',
    test: 'bun run test',
    'test-full': 'bun run test:full',
    'test-heavy': 'bun run test:heavy',
    'rules-pre': 'bun run test-pre-check',
    'rules-post': 'bun run test-post-check',
    check: 'bun run spur-check',
    'check-full': 'bun run spur-check:full',
    'check-feature': 'bun run spur-check-feature',
    'lint-changed': 'bunx biome check {files}',
    'typecheck-changed': 'cd {workspace} && bun run typecheck',
    'test-changed': 'cd {workspace} && bun test {paths}',
};

/**
 * Stack-neutral defaults under `preset: none` (R5). Defined in `packages/config` because the schema's
 * resolvable set is derived from the same map — one copy, so a default added here cannot be rejected
 * at load time as "resolves to no action". Every other undeclared reserved action is unbound there.
 */
const STACK_NEUTRAL_DEFAULTS: Readonly<Partial<Record<ReservedAction, string>>> = SDLC_STACK_NEUTRAL_ACTIONS;

/** Where a resolution came from. */
export type ActionSource = 'config' | 'preset' | 'default' | 'unbound';

/** One resolved action: the binding plus where it came from. */
export type ResolvedAction = { name: string; reserved: boolean; source: ActionSource } & (
    | { kind: 'command'; command: string }
    | { kind: 'composite'; steps: string[] }
    | { kind: 'unbound' }
);

/** Is `name` in the reserved vocabulary? */
export function isReservedAction(name: string): name is ReservedAction {
    return (RESERVED_ACTIONS as readonly string[]).includes(name);
}

/** Resolve one action name against the builder binding (see the module doc for the order). */
export function resolveAction(builder: BuilderConfig | undefined, name: string): ResolvedAction {
    const reserved = isReservedAction(name);
    const declared = builder?.actions?.[name];
    if (declared !== undefined) {
        return Array.isArray(declared)
            ? { name, reserved, source: 'config', kind: 'composite', steps: [...declared] }
            : { name, reserved, source: 'config', kind: 'command', command: declared };
    }
    if ((builder?.preset ?? 'bun') === 'bun') {
        if (reserved) return { name, reserved, source: 'preset', kind: 'command', command: BUN_PRESET[name] };
    } else {
        const command = reserved ? STACK_NEUTRAL_DEFAULTS[name] : undefined;
        if (command !== undefined) return { name, reserved, source: 'default', kind: 'command', command };
    }
    return { name, reserved, source: 'unbound', kind: 'unbound' };
}

/** Every action in listing order: reserved first (vocabulary order), then declared custom names sorted. */
export function listActions(builder: BuilderConfig | undefined): ResolvedAction[] {
    const custom = Object.keys(builder?.actions ?? {})
        .filter((name) => !isReservedAction(name))
        .sort();
    return [...RESERVED_ACTIONS, ...custom].map((name) => resolveAction(builder, name));
}

/** Values a `{files}` / `{paths}` / `{workspace}` placeholder substitutes. */
export interface ScopedValues {
    files?: string[];
    paths?: string[];
    workspace?: string;
}

/**
 * Substitute the scoped placeholders in a `*-changed` command, quoting each item with
 * {@link shQuote}. A placeholder whose value is missing or empty throws: an empty substitution
 * would silently widen the command (`biome check` with no paths checks the whole repo).
 */
export function renderScoped(command: string, values: ScopedValues): string {
    let rendered = command;
    for (const [placeholder, items] of [
        ['{files}', values.files],
        ['{paths}', values.paths],
    ] as const) {
        if (!rendered.includes(placeholder)) continue;
        if (items === undefined) throw new Error(`renderScoped: ${placeholder} has no value`);
        if (items.length === 0) throw new Error(`renderScoped: ${placeholder} has an empty list`);
        rendered = rendered.replaceAll(placeholder, () => items.map(shQuote).join(' '));
    }
    if (rendered.includes('{workspace}')) {
        const workspace = values.workspace;
        if (workspace === undefined) throw new Error('renderScoped: {workspace} has no value');
        if (workspace.length === 0) throw new Error('renderScoped: {workspace} is empty');
        rendered = rendered.replaceAll('{workspace}', () => shQuote(workspace));
    }
    return rendered;
}
