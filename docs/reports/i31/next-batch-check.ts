import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { computePlanningDigest, verifyReadyChecks } from '../../../packages/app/src/services/task-readiness';

const root = resolve(import.meta.dir, '../../..');
const receipt = await Bun.file(resolve(import.meta.dir, 'next-batch-readiness.json')).json();
assert.deepEqual(
    receipt.tasks.map((task: { wbs: string }) => task.wbs),
    ['0906', '0907', '0908', '0909'],
);

for (const task of receipt.tasks) {
    const process = Bun.spawn(['bun', 'run', 'apps/cli/src/index.ts', 'task', 'show', task.wbs, '--json'], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const [stdout, stderr] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
    ]);
    assert.equal(await process.exited, 0, stderr);
    const current = JSON.parse(stdout);
    assert.equal(computePlanningDigest(await Bun.file(current.filePath).text()), task.planningDigest, task.wbs);
    assert.equal(verifyReadyChecks(task.checks).ok, true, task.wbs);
    assert.equal(current.frontmatter.feature_id, task.featureId, task.wbs);
    assert.equal(Number(current.frontmatter.estimate_hours), task.estimateHours, task.wbs);
    assert.deepEqual(current.frontmatter.dependencies ?? [], task.dependencies, task.wbs);
    assert.equal(
        task.structuralGate.every((gate: { pass: boolean }) => gate.pass),
        true,
        task.wbs,
    );
}

assert.equal(
    receipt.features.every((feature: { result: Array<{ pass: boolean }> }) =>
        feature.result.every((gate) => gate.pass),
    ),
    true,
);
console.log(JSON.stringify({ pass: true, tasks: receipt.tasks.length, scope: 'planning receipt integrity' }));
