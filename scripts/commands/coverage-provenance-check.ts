#!/usr/bin/env bun
/**
 * Coverage provenance precondition (task 1203 R2) — the repository post-check runs
 * this before rule evaluation:
 *
 *     bun scripts/spur-dev.ts coverage-provenance-check && bun run apps/cli/src/index.ts rule run …
 *
 * Refuses closed with a distinct `coverage-artifact:` diagnostic when
 * `.coverage/coverage-certification.json` does not certify the CURRENT
 * `.coverage/lcov.info` bytes and working tree: missing, pending (interrupted /
 * failed / in-flight run), superseded, malformed, stale-tree, missing-lcov or
 * byte-mismatched evidence exits nonzero and per-file coverage findings are never
 * produced from uncertified data. Certified evidence passes through unchanged to the
 * existing coverage-gate evaluator (same path, globs, diagnostics, 90% threshold).
 *
 * Canonical recovery: `bun run test:full` — a completed successful canonical
 * full-suite run republishes certification. Running the portable rule directly
 * (`spur rule run` outside these scripts) bypasses this wrapper by design and is
 * outside this repository's certification contract.
 */
import { CANONICAL_RECOVERY, validateCoverageCertification } from './coverage-certification';

const result = await validateCoverageCertification(process.cwd());
if (result.ok) {
    process.exit(0);
}
process.stderr.write(`coverage-artifact: ${result.reason} — ${result.message}\n`);
process.stderr.write(`coverage-artifact: recovery — ${CANONICAL_RECOVERY}\n`);
process.exit(1);
