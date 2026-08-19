import { finalizeIdeaHandoff } from './idea-handoff';

const runId = process.env.__runId ?? '';
const featureId = process.env.featureId ?? '';
if (runId === '' || featureId === '') {
    process.stderr.write('idea-handoff: __runId and featureId env vars are required\n');
    process.exit(1);
}

const result = await finalizeIdeaHandoff({
    runId,
    featureId,
    spurBin: process.env.spurBin ?? 'spur',
});
if (!result.ok) {
    process.stderr.write(`idea-handoff: ${result.error ?? 'failed'}\n`);
    process.exit(1);
}
