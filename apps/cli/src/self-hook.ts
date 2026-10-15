import type { Command } from '@commander-js/extra-typings';
import {
    HOOK_DEFINITIONS,
    HOOK_HOSTS,
    HOOK_IDS,
    type HookHostOption,
    type HookRunInput,
    type HookRunResult,
    runSpurHook,
} from '@gobing-ai/spur-app/hooks';
import { SHARED_OPTIONS } from './commands/shared-options';
import type { CliContext } from './context';
import { toEnvelopeJson } from './output';
import { SELF_HOOK_VERB } from './self-hook-argv';
import { resolveSpurArgv } from './workflow/resolve-spur-bin';

export { isSelfHookInvocation, SELF_HOOK_VERB } from './self-hook-argv';

/** Seams for {@link registerSelfHookCommand}; the defaults are the live process. */
export interface SelfHookDeps {
    /** Read the host payload; defaults to all of stdin. */
    readStdin?: () => Promise<string>;
    /** Byte-exact stdout writer (hook decisions are not newline-terminated); defaults to process.stdout. */
    writeRaw?: (text: string) => void;
    /** Byte-exact stderr writer; defaults to process.stderr. */
    writeRawError?: (text: string) => void;
    /** Hook runner; defaults to the app's {@link runSpurHook}. */
    run?: (id: string, input: HookRunInput) => HookRunResult;
    /** Launch argv of this spur build, for hook children; defaults to {@link resolveSpurArgv}. */
    selfArgv?: readonly string[];
}

function parseHost(value: string): HookHostOption {
    if ((HOOK_HOSTS as readonly string[]).includes(value)) return value as HookHostOption;
    throw new Error(`--host must be one of ${HOOK_HOSTS.join(', ')} (got '${value}')`);
}

function listText(): string {
    const width = Math.max(...HOOK_IDS.map((id) => id.length));
    return HOOK_DEFINITIONS.map(
        (definition) =>
            `${definition.id.padEnd(width)}  ${definition.kind.padEnd(9)}  ${definition.events.join(', ')}\n${' '.repeat(width + 2)}${definition.summary}`,
    ).join('\n');
}

/**
 * Register `spur self hook <id> [--host …]` and `spur self hook list` under `parent`.
 *
 * Thin transport only (script-absorption plan PR-2a, owner decision Q1: hooks live under
 * `self`): read stdin, call the app runner, write its output byte-for-byte, exit 0. All
 * hook behaviour lives in `@gobing-ai/spur-app/hooks`, so the mount point can change cheaply.
 */
export function registerSelfHookCommand(
    parent: Command,
    context: Pick<CliContext, 'cwd' | 'env' | 'output' | 'setExitCode'>,
    deps: SelfHookDeps = {},
): void {
    parent
        .command(SELF_HOOK_VERB)
        .summary('run a host hook (stdin payload → host-shaped decision); `list` shows ids')
        .description(
            [
                'Host hook transport (the target for `superskill hook run sp <id>` and the Pi extension).',
                'Reads the host payload on stdin and always exits 0 (fail-open).',
                '  spur self hook task-write-guard < payload.json',
                '  spur self hook careful-guard --host pi < pi-event.json',
                '  spur self hook list [--json]',
                `Ids: ${HOOK_IDS.join(', ')}.`,
            ].join('\n'),
        )
        .argument('<id>', `hook id, or \`list\` (${HOOK_IDS.join(' | ')})`)
        .option('--host <host>', `payload/output shape: ${HOOK_HOSTS.join(' | ')}`, parseHost, 'auto')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            if (id === 'list') {
                context.output.write(
                    options.json === true
                        ? toEnvelopeJson(HOOK_DEFINITIONS, { enveloped: options.jsonEnvelope })
                        : listText(),
                );
                return;
            }
            let stdin = '';
            try {
                stdin = await (deps.readStdin ?? (() => Bun.stdin.text()))();
            } catch {
                stdin = '';
            }
            const result = (deps.run ?? runSpurHook)(id, {
                host: options.host,
                stdin,
                env: context.env,
                cwd: context.cwd,
                selfArgv: deps.selfArgv ?? resolveSpurArgv(),
            });
            if (result.stdout !== '') (deps.writeRaw ?? ((text) => process.stdout.write(text)))(result.stdout);
            if (result.stderr !== '') (deps.writeRawError ?? ((text) => process.stderr.write(text)))(result.stderr);
            context.setExitCode(0);
        });
}
