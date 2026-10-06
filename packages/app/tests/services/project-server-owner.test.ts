import { afterEach, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireProjectServerOwner } from '../../src/services/project-server-owner';

const projects: string[] = [];
const project = () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-owner-'));
    projects.push(root);
    return root;
};
afterEach(() => {
    for (const root of projects.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** Marker name a foreign owner would write (only the pid carries meaning here). */
const markerFor = (pid: number) => `${pid}-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;

test('atomic lifetime ownership refuses a concurrent startup and allows the next after release', async () => {
    const root = project();
    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => acquireProjectServerOwner(root, { handoffTimeoutMs: 0 })),
        Promise.resolve().then(() => acquireProjectServerOwner(root, { handoffTimeoutMs: 0 })),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1);
    for (const result of attempts) if (result.status === 'fulfilled') result.value.release();
    const next = acquireProjectServerOwner(root);
    next.release();
    next.release();
});

test('recovers a dead PID claim but fails closed for an incomplete claim', () => {
    const root = project();
    const directory = join(root, '.spur', 'server-owner.lock');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, '2147483647-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), '');
    const recovered = acquireProjectServerOwner(root);
    recovered.release();
    mkdirSync(directory);
    expect(() => acquireProjectServerOwner(root)).toThrow('incomplete');
    expect(existsSync(directory)).toBe(true);
});

test('an old release never removes a replacement ownership claim', () => {
    const root = project();
    const old = acquireProjectServerOwner(root);
    const directory = join(root, '.spur', 'server-owner.lock');
    renameSync(directory, `${directory}.old`);
    const next = acquireProjectServerOwner(root);
    old.release();
    expect(() => acquireProjectServerOwner(root, { handoffTimeoutMs: 0 })).toThrow('already has a server owner');
    next.release();
});

test('waits for a stopping owner to drop its live claim instead of refusing the restart', async () => {
    const root = project();
    const directory = join(root, '.spur', 'server-owner.lock');
    // The stopping owner: a live pid holding the claim, released mid-wait the way a draining
    // serve releases it (only after its runtime and DB have drained).
    const holder = spawn('sleep', ['5']);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, markerFor(holder.pid ?? 0)), '');
    const releaser = spawn('/bin/sh', ['-c', 'sleep 0.3; rm -rf "$1"', 'sh', directory]);
    const recovered = acquireProjectServerOwner(root, { handoffTimeoutMs: 5_000 });
    recovered.release();
    holder.kill();
    releaser.kill();
});

test('a live owner that never releases keeps its claim and the refusal is bounded', () => {
    const root = project();
    const directory = join(root, '.spur', 'server-owner.lock');
    const holder = spawn('sleep', ['5']);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, markerFor(holder.pid ?? 0)), '');
    const started = Date.now();
    expect(() => acquireProjectServerOwner(root, { handoffTimeoutMs: 150, handoffPollMs: 20 })).toThrow(
        'already has a server owner',
    );
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(readdirSync(directory)).toEqual([markerFor(holder.pid ?? 0)]);
    holder.kill();
});
