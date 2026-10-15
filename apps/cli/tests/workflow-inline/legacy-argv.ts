/**
 * Test-only translation of the retired plugin-script argv (`inline-run-setup.ts --close --run-id …`,
 * `inline-run-dispatch.ts --attribution …`) into `spur workflow inline <op> …`, so the scripts'
 * spawn-based integration suites kept their bodies when they moved to the CLI (script-absorption
 * PR-4). The mapping is the one the driver docs now spell out:
 *
 * - the first mode flag picks the op (`--action` → `action`, `--actions-file <f>` → `actions --file <f>`,
 *   no mode → `begin`); any later mode flag stays a raw flag, so a mixed call is still a usage error;
 * - `--spur-bin` survives only on `begin` (the one op that resolves a definition);
 * - argv that already names a command (`workflow show …`, the inventory re-entry) passes through.
 */
const MODES: Record<string, string> = {
    '--fingerprint': 'fingerprint',
    '--action': 'action',
    '--close': 'close',
    '--decide': 'decide',
    '--node-enter': 'node-enter',
    '--persist-out': 'persist-out',
    '--attribution': 'attribution',
    '--dispatch-failure': 'dispatch-failure',
};

export function translateLegacyInlineArgv(argv: readonly string[]): string[] {
    if (argv.length > 0 && !(argv[0] ?? '').startsWith('--')) return [...argv];
    let op: string | undefined;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i] as string;
        if (op === undefined && MODES[token] !== undefined) {
            op = MODES[token];
        } else if (op === undefined && token === '--actions-file') {
            op = 'actions';
            rest.push('--file', argv[++i] ?? '');
        } else if (token === '--spur-bin') {
            rest.push(token, argv[++i] ?? '');
        } else {
            rest.push(token);
        }
    }
    const resolved = op ?? 'begin';
    const args =
        resolved === 'begin' ? rest : rest.filter((token, i) => token !== '--spur-bin' && rest[i - 1] !== '--spur-bin');
    return ['workflow', 'inline', resolved, ...args];
}
