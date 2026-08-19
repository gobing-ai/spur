import { appendWrapupMetrics } from './wrapup-metrics';

const result = await appendWrapupMetrics({
    tasksRaw: process.env.tasks ?? '[]',
    spurBin: process.env.spurBin ?? 'spur',
});
process.exit(result.ok ? 0 : 1);
