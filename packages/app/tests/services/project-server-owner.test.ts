import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

test('atomic lifetime ownership refuses a concurrent startup and allows the next after release', async () => {
    const root = project();
    const attempts = await Promise.allSettled([
        Promise.resolve().then(() => acquireProjectServerOwner(root)),
        Promise.resolve().then(() => acquireProjectServerOwner(root)),
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
    expect(() => acquireProjectServerOwner(root)).toThrow('already has a server owner');
    next.release();
});
