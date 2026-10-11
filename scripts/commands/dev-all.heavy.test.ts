import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';

const REPO = resolve(import.meta.dir, '../..');

test.each([
    'clean',
    'failure',
    'child-signal',
    'parent-signal',
    'spawn-error',
])('dev supervisor owns cleanup and exit status: %s', async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'spur-dev-supervision-'));
    const events = join(root, 'events.jsonl');
    const fixture = `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { getEnvVars } from ${JSON.stringify(join(REPO, 'packages/config/src/index.ts'))};
const env=getEnvVars();
const event=(role)=>appendFileSync(env.EVENTS,JSON.stringify({role,pid:process.pid})+'\\n');
const role=process.argv[2]==='foreign'?'foreign':process.argv[2]==='grandchild'?'grandchild':process.argv.includes('@gobing-ai/spur-server')?'server':'web';
event(role);
if(role==='grandchild') process.on('SIGTERM',()=>{});
if(role==='grandchild') writeFileSync(env.GRANDCHILD_READY,'ready');
if(role==='server') {
    Bun.spawn([process.execPath,import.meta.filename,'grandchild'],{env,stdio:['ignore','ignore','ignore']});
    while(!existsSync(env.PEER_READY)||!existsSync(env.GRANDCHILD_READY)) await Bun.sleep(10);
    if(env.MODE==='clean') process.exit(0);
    if(env.MODE==='failure') process.exit(7);
    if(env.MODE==='child-signal') process.kill(process.pid,'SIGTERM');
}
if(role==='web') writeFileSync(env.PEER_READY,'ready');
setInterval(()=>{},1000);
`;
    const bin = join(root, 'bun');
    await Bun.write(bin, fixture);
    await chmod(bin, 0o755);
    const env = {
        ...getEnvVars(),
        EVENTS: events,
        PEER_READY: join(root, 'peer-ready'),
        GRANDCHILD_READY: join(root, 'grandchild-ready'),
        MODE: mode,
    };
    const foreign = Bun.spawn([process.execPath, bin, 'foreign'], { env, stdout: 'ignore', stderr: 'ignore' });
    await Bun.write(join(root, 'lsof'), `#!${process.execPath}\nconsole.log(${foreign.pid});\n`);
    await chmod(join(root, 'lsof'), 0o755);
    while (!(await Bun.file(events).exists())) await Bun.sleep(10);
    if (mode === 'spawn-error') await rm(bin);
    const proc = Bun.spawn([process.execPath, join(REPO, 'scripts/spur-dev.ts'), 'dev-all'], {
        cwd: REPO,
        env: { ...env, PATH: mode === 'spawn-error' ? root : `${root}:${getEnvVar('PATH') ?? '/usr/bin:/bin'}` },
        detached: true,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const readEvents = async (): Promise<Array<{ role: string; pid: number }>> => {
        const text = await Bun.file(events)
            .text()
            .catch(() => '');
        return text
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    };
    try {
        const deadline = Date.now() + 10_000;
        if (mode === 'parent-signal') {
            while (!(await readEvents()).some((entry) => entry.role === 'grandchild') && Date.now() < deadline)
                await Bun.sleep(20);
            proc.kill('SIGINT');
        }
        while (proc.exitCode === null && Date.now() < deadline) await Bun.sleep(20);
        expect(proc.exitCode).not.toBeNull();
        expect(proc.exitCode).toBe(
            mode === 'clean'
                ? 0
                : mode === 'failure'
                  ? 7
                  : mode === 'parent-signal'
                    ? 130
                    : mode === 'child-signal'
                      ? 143
                      : 1,
        );
        expect(foreign.exitCode).toBeNull();
        const owned = (await readEvents()).filter((entry) => entry.role !== 'foreign');
        if (mode !== 'spawn-error') {
            expect(owned.some((entry) => entry.role === 'grandchild')).toBe(true);
            for (const entry of owned) {
                let alive = true;
                const goneBy = Date.now() + 1000;
                while (alive && Date.now() < goneBy) {
                    try {
                        process.kill(entry.pid, 0);
                    } catch {
                        alive = false;
                    }
                    if (alive) await Bun.sleep(20);
                }
                expect(alive).toBe(false);
            }
        }
        const log = await new Response(proc.stderr).text();
        await Bun.write(
            join(REPO, `.spur/run/scripts-conflict-repairs/dev-${mode}.json`),
            JSON.stringify(
                { mode, exitCode: proc.exitCode, foreignSurvived: foreign.exitCode === null, owned, log },
                null,
                2,
            ),
        );
    } finally {
        try {
            process.kill(-proc.pid, 'SIGKILL');
        } catch {
            /* already gone */
        }
        for (const entry of await readEvents()) {
            try {
                process.kill(entry.pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
        }
        await proc.exited;
        await foreign.exited;
        await rm(root, { recursive: true, force: true });
    }
}, 20_000);
