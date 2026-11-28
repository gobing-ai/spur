/**
 * Batch `--help` capture child (task 1475 R2) — boots the source CLI once and emits every command
 * path's help text as one `{ "<path>": "<text>" }` JSON map on stdout.
 *
 * `captureCliSurface` needs one capture per command path (root, each noun, each noun+verb). Spawning
 * the CLI for each of the 140-odd paths was the single biggest avoidable cost in the `docs/help`
 * parity suite; the surface itself is the same program, so one boot answers every path.
 *
 * Runs as a child of the helper — never imported by a test — so the helper keeps its synchronous
 * `Bun.spawnSync` contract and its failure branches.
 */
import { fileURLToPath } from 'node:url';
import { main } from '../../../../apps/cli/src/index';
import { parseCommanderHelp } from './cli-surface';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** Commander's generated help command: capturing it proves nothing and it is not a surface member. */
const HELP_NOUN = 'help';

const texts: Record<string, string> = {};

/** Capture one path's help text and return the commands it lists. */
async function capture(commandPath: string[]): Promise<string[]> {
    const chunks: string[] = [];
    const code = await main([...commandPath, '--help'], {
        cwd: REPO_ROOT,
        output: {
            write: (message: string) => chunks.push(message),
            error: (message: string) => chunks.push(message),
        },
    });
    const text = chunks.map((chunk) => `${chunk}\n`).join('');
    if (code !== 0) {
        throw new Error(`cli-surface-capture: \`${commandPath.join(' ')} --help\` exited ${code}`);
    }
    texts[commandPath.join(' ')] = text;
    return parseCommanderHelp(text).commands;
}

const nouns = await capture([]);
for (const noun of nouns.filter((name) => name !== HELP_NOUN)) {
    for (const verb of await capture([noun])) {
        if (verb !== HELP_NOUN) await capture([noun, verb]);
    }
}

process.stdout.write(JSON.stringify(texts));
