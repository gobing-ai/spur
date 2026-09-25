#!/usr/bin/env node
// @bun

// plugins/sp/scripts/quality-gate.ts
import { spawnSync } from "child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/quality-gate.ts
var MAX_GATE_ATTEMPTS = 5;
var MAX_FINDINGS = 20;
var RETRY_DELAY_MS_DEFAULT = 1e4;
var RETRY_DELAY_MS_ENV = "SPUR_QUALITY_GATE_RETRY_DELAY_MS";
var LOCKED_PATTERN = /SQLiteError: database is locked|SQLite database .*is busy|SQLITE_BUSY/;
var FINDINGS_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
var COVERAGE_ROW_PATTERN = /^\s*(\S+\.[A-Za-z]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\S*)/;
function isTransientLock(attemptOutput) {
  return LOCKED_PATTERN.test(attemptOutput);
}
function extractFindings(logText) {
  const found = new Set;
  for (const match of logText.matchAll(FINDINGS_PATTERN))
    found.add(match[0]);
  return [...found].sort().slice(0, MAX_FINDINGS).map((anchor) => `${anchor} `).join("");
}
function tailLines(text, count) {
  const lines = text.split(`
`);
  if (lines.length > 0 && lines[lines.length - 1] === "")
    lines.pop();
  const tail = lines.slice(Math.max(0, lines.length - count));
  return tail.length === 0 ? "" : `${tail.join(`
`)}
`;
}
function retryMessage(attempt) {
  return `quality gate: database is locked; retrying (${attempt}/${MAX_GATE_ATTEMPTS}) in 10s
`;
}
function parseCoverageThreshold(bunfigText) {
  const block = bunfigText.match(/coverageThreshold\s*=\s*\{([^}]*)\}/);
  if (!block)
    return null;
  const threshold = {};
  for (const axis of ["functions", "lines"]) {
    const raw = block[1]?.match(new RegExp(`\\b${axis}\\s*=\\s*([\\d.]+)`))?.[1];
    const value = raw === undefined ? Number.NaN : Number.parseFloat(raw);
    if (Number.isFinite(value))
      threshold[axis] = value;
  }
  return threshold.functions === undefined && threshold.lines === undefined ? null : threshold;
}
function scanCoverageShortfalls(logText, threshold) {
  const shortfalls = new Map;
  for (const line of logText.split(`
`)) {
    const row = line.match(COVERAGE_ROW_PATTERN);
    if (!row)
      continue;
    const [, path, funcs, lines, uncovered] = row;
    if (!path || path === "All files" || shortfalls.has(path))
      continue;
    const belowFunctions = threshold.functions !== undefined && Number.parseFloat(funcs ?? "") < threshold.functions * 100;
    const belowLines = threshold.lines !== undefined && Number.parseFloat(lines ?? "") < threshold.lines * 100;
    if (!belowFunctions && !belowLines)
      continue;
    const firstUncovered = uncovered?.match(/\d+/)?.[0] ?? "1";
    shortfalls.set(path, `quality gate: coverage shortfall ${path}:${firstUncovered} funcs=${funcs} lines=${lines}`);
  }
  return [...shortfalls.values()];
}
var RECEIPT_SCHEMA_VERSION = "check-receipt/v1";
function buildReceipt(input) {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    wbs: input.wbs,
    runId: input.runId,
    tier: input.tier,
    inputDigest: input.inputDigest,
    checks: input.checks,
    status: input.checks.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
    completedAt: input.completedAt
  };
}
function readReceipt(receiptPath) {
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch {
    return null;
  }
}
function receiptFailsAtDigest(receipt, currentDigest) {
  return receipt !== null && receipt.schemaVersion === RECEIPT_SCHEMA_VERSION && receipt.tier === "full" && receipt.status === "FAIL" && currentDigest.length > 0 && receipt.inputDigest === currentDigest;
}
function readReceiptStatus(receiptPath, currentDigest) {
  const receipt = readReceipt(receiptPath);
  if (receipt === null || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
    return { reuse: false, reason: "missing" };
  }
  if (receipt.status !== "PASS")
    return { reuse: false, reason: "failed" };
  if (currentDigest.length === 0 || receipt.inputDigest !== currentDigest) {
    return { reuse: false, reason: "stale" };
  }
  if (receipt.tier !== "full")
    return { reuse: false, reason: "light-only" };
  return { reuse: true, reason: "ok" };
}
var TEST_FILE_PATTERN = /\.test\.tsx?$/;
function workspaceOf(file, exists) {
  const segments = file.split("/");
  for (let depth = 1;depth < segments.length; depth++) {
    const prefix = segments.slice(0, depth).join("/");
    if (exists(`${prefix}/package.json`))
      return prefix;
  }
  return null;
}
function lightScope(changedFiles, exists = existsSync) {
  const files = [];
  const workspaces = new Set;
  const tests = new Set;
  for (const file of changedFiles) {
    files.push(file);
    const workspace = workspaceOf(file, exists);
    if (workspace === null)
      continue;
    workspaces.add(workspace);
    const rest = file.slice(workspace.length + 1);
    if (rest.startsWith("src/")) {
      const candidate = `${workspace}/tests/${rest.slice("src/".length).replace(/\.tsx?$/, (ext) => `.test${ext}`)}`;
      if (exists(candidate))
        tests.add(candidate);
    } else if (rest.startsWith("tests/") && TEST_FILE_PATTERN.test(rest)) {
      tests.add(file);
    }
  }
  return { files, workspaces: [...workspaces].sort(), tests: [...tests].sort() };
}
function workspaceHasTypecheck(workspace) {
  try {
    const pkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8"));
    return typeof pkg.scripts?.typecheck === "string";
  } catch {
    return false;
  }
}
function planLightChecks(scope, hasTypecheck = workspaceHasTypecheck) {
  const plans = [];
  if (scope.files.length > 0) {
    plans.push({ id: "format-lint:changed", cmd: `bunx biome check ${scope.files.join(" ")}` });
  }
  for (const workspace of scope.workspaces) {
    if (hasTypecheck(workspace)) {
      plans.push({ id: `typecheck:${workspace}`, cmd: `cd ${workspace} && bun run typecheck` });
    }
  }
  const testsByWorkspace = new Map;
  for (const test of scope.tests) {
    const workspace = test.slice(0, test.indexOf("/tests/"));
    const paths = testsByWorkspace.get(workspace) ?? [];
    paths.push(test.slice(workspace.length + 1));
    testsByWorkspace.set(workspace, paths);
  }
  for (const [workspace, paths] of testsByWorkspace) {
    plans.push({ id: `test:${workspace}`, cmd: `cd ${workspace} && bun test ${paths.join(" ")}` });
  }
  return plans;
}
function gitChangedFiles(cwd) {
  const abs = (p) => cwd ? join(cwd, p) : p;
  const changed = new Set;
  for (const cmd of ["git diff --name-only HEAD", "git ls-files --others --exclude-standard"]) {
    const result = runShellCommand(cmd, cwd);
    for (const line of result.output.split(`
`)) {
      const file = line.trim();
      if (file.length > 0 && existsSync(abs(file)))
        changed.add(file);
    }
  }
  return [...changed].sort();
}
function receiptRunId(env) {
  return (env.runId ?? "").length > 0 ? env.runId : `pipeline-${env.wbs}`;
}
function runLightGate(env, options = {}) {
  const cwd = options.cwd;
  const abs = (p) => cwd ? join(cwd, p) : p;
  const runDir = join(".spur", "run");
  mkdirSync(abs(runDir), { recursive: true });
  const logFile = join(runDir, `${env.wbs}-light-gate.log`);
  const receiptFile = join(runDir, `${env.wbs}-check-receipt.json`);
  writeFileSync(abs(logFile), "");
  const digest = env.proofDigest ?? "";
  const scope = lightScope(gitChangedFiles(cwd), (p) => existsSync(abs(p)));
  const plans = planLightChecks(scope, (workspace) => workspaceHasTypecheck(abs(workspace)));
  const reusable = new Map;
  let preserveFullReceipt = false;
  if (digest.length > 0) {
    try {
      const prior = JSON.parse(readFileSync(abs(receiptFile), "utf8"));
      if (prior?.schemaVersion === RECEIPT_SCHEMA_VERSION && prior.inputDigest === digest) {
        if (prior.tier === "full") {
          preserveFullReceipt = true;
        } else {
          for (const row of prior.checks ?? [])
            if (row.status === "PASS")
              reusable.set(row.id, row);
        }
      }
    } catch {}
  }
  const checks = [];
  let skipped = 0;
  for (const plan of plans) {
    const priorRow = reusable.get(plan.id);
    if (priorRow !== undefined) {
      checks.push(priorRow);
      skipped++;
      const line = `--- light ${plan.id}: check.reused \u2014 skipped (PASS at the same input digest)
`;
      process.stdout.write(line);
      appendFileSync(abs(logFile), line);
      continue;
    }
    const startedAtMs = Date.now();
    const result = runShellCommand(plan.cmd, cwd);
    const durationMs = Date.now() - startedAtMs;
    const status = result.code === 0 ? "PASS" : "FAIL";
    appendFileSync(abs(logFile), `--- light ${plan.id}: ${status} (${durationMs}ms)
${result.output}`);
    checks.push({ id: plan.id, cmd: plan.cmd, status, durationMs, logPath: logFile });
  }
  const receipt = buildReceipt({
    wbs: env.wbs,
    runId: receiptRunId(env),
    tier: "light",
    inputDigest: digest,
    checks,
    completedAt: new Date().toISOString()
  });
  if (preserveFullReceipt) {
    appendFileSync(abs(logFile), `--- light receipt: not written \u2014 the full-tier receipt at the same input digest is preserved
`);
    process.stdout.write(`light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` + ` skipped: ${skipped}; receipt: ${receiptFile} preserved (full tier); log: ${logFile})
`);
  } else {
    writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}
`);
    process.stdout.write(`light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` + ` skipped: ${skipped}; receipt: ${receiptFile}; log: ${logFile})
`);
  }
  return { status: receipt.status, scope, checks, logFile, receiptFile };
}
function retryDelayMs(env) {
  const raw = Number.parseInt(env[RETRY_DELAY_MS_ENV] ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : RETRY_DELAY_MS_DEFAULT;
}
function gateSleep(ms) {
  if (ms > 0)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function runShellCommand(cmd, cwd) {
  const dir = mkdtempSync(join(tmpdir(), "spur-quality-gate-"));
  const path = join(dir, "output");
  const fd = openSync(path, "w");
  try {
    const result = spawnSync("sh", ["-c", cmd], { cwd, stdio: ["ignore", fd, fd] });
    if (result.error !== undefined) {
      return { output: `sh -c failed: ${result.error.message}
`, code: 1 };
    }
    return { output: readFileSync(path, "utf8"), code: result.status ?? 1 };
  } finally {
    closeSync(fd);
    rmSync(dir, { recursive: true, force: true });
  }
}
function runQualityGate(mode, env, options = {}) {
  const cwd = options.cwd;
  const runDir = join(".spur", "run");
  mkdirSync(cwd ? join(cwd, runDir) : runDir, { recursive: true });
  const rel = (name) => join(runDir, `${env.wbs}${name}`);
  const logFile = rel("-test-gate.log");
  const findingsFile = rel("-test-gate.findings");
  const statusFile = rel("-test-gate.status");
  const attemptFile = rel("-test-fix-attempt");
  const abs = (p) => cwd ? join(cwd, p) : p;
  writeFileSync(abs(logFile), "");
  if (mode === "run")
    writeFileSync(abs(attemptFile), `0
`);
  const gateStartedAtMs = Date.now();
  let gateRc = 0;
  let gateAttempt = 0;
  const noProgressSkip = mode === "recheck" && receiptFailsAtDigest(readReceipt(abs(rel("-check-receipt.json"))), env.proofDigest ?? "");
  if (noProgressSkip) {
    const line = `check.skipped-no-progress \u2014 full-tier FAIL receipt at input digest ${env.proofDigest ?? ""}; recheck skipped
`;
    process.stdout.write(line);
    appendFileSync(abs(logFile), line);
    gateRc = 1;
  }
  if (mode === "recheck" && !noProgressSkip && (env.gateProbeCmd ?? "").length > 0) {
    const probe = runShellCommand(env.gateProbeCmd ?? "", cwd);
    writeFileSync(abs(`${logFile}.probe`), probe.output);
    gateRc = probe.code;
    appendFileSync(abs(logFile), probe.output);
    rmSync(abs(`${logFile}.probe`), { force: true });
  }
  if (gateRc === 0) {
    const delayMs = retryDelayMs(env);
    for (gateAttempt = 1;gateAttempt <= MAX_GATE_ATTEMPTS; gateAttempt++) {
      const attemptLogPath = `${logFile}.attempt-${gateAttempt}`;
      const attempt = runShellCommand(env.qualityGateCmd ?? "", cwd);
      writeFileSync(abs(attemptLogPath), attempt.output);
      const locked = isTransientLock(attempt.output);
      appendFileSync(abs(logFile), attempt.output);
      rmSync(abs(attemptLogPath), { force: true });
      gateRc = attempt.code;
      if (gateRc === 0 || !locked || gateAttempt >= MAX_GATE_ATTEMPTS)
        break;
      const line = retryMessage(gateAttempt);
      process.stdout.write(line);
      appendFileSync(abs(logFile), line);
      gateSleep(delayMs);
    }
  }
  if (gateRc !== 0) {
    const gateLog = existsSync(abs(logFile)) ? readFileSync(abs(logFile), "utf8") : "";
    if (/^\s*0 fail\b/m.test(gateLog) && !/^\s*[1-9]\d*\s+fail\b/m.test(gateLog)) {
      const bunfigPath = cwd ? join(cwd, "bunfig.toml") : "bunfig.toml";
      const threshold = existsSync(bunfigPath) ? parseCoverageThreshold(readFileSync(bunfigPath, "utf8")) : null;
      if (threshold) {
        for (const shortfall of scanCoverageShortfalls(gateLog, threshold)) {
          process.stdout.write(`${shortfall}
`);
          appendFileSync(abs(logFile), `${shortfall}
`);
        }
      }
    }
  }
  if (gateRc === 0) {
    const bytes = existsSync(abs(logFile)) ? statSync(abs(logFile)).size : 0;
    const attemptsLabel = gateAttempt > 0 ? String(gateAttempt) : "";
    process.stdout.write(`quality gate PASS (attempts: ${attemptsLabel}; log: ${logFile}; bytes: ${bytes})
`);
  } else {
    process.stdout.write(`quality gate FAIL \u2014 last 40 lines follow (full log: ${logFile})
`);
    process.stdout.write(tailLines(readFileSync(abs(logFile), "utf8"), 40));
  }
  writeFileSync(abs(findingsFile), extractFindings(readFileSync(abs(logFile), "utf8")));
  const status = gateRc === 0 ? "PASS" : "FAIL";
  writeFileSync(abs(statusFile), `${status}
`);
  appendFileSync(abs(logFile), `proof-digest: ${env.proofDigest ?? ""}
`);
  let receiptFile;
  if (mode === "run") {
    if ((env.proofDigest ?? "").length > 0) {
      receiptFile = join(runDir, `${env.wbs}-check-receipt.json`);
      const receipt = buildReceipt({
        wbs: env.wbs,
        runId: receiptRunId(env),
        tier: "full",
        inputDigest: env.proofDigest ?? "",
        checks: [
          {
            id: "test",
            cmd: env.qualityGateCmd ?? "",
            status,
            durationMs: Date.now() - gateStartedAtMs,
            logPath: logFile
          }
        ],
        completedAt: new Date().toISOString()
      });
      writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}
`);
    } else {
      appendFileSync(abs(logFile), "check-receipt: not written \u2014 env `proofDigest` is not set\n");
    }
  }
  return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile, receiptFile };
}
var QUALITY_GATE_USAGE = "usage: quality-gate.ts <run|recheck|light|status>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest, runId)";
function main(argv, env = getEnvVars(), options = {}) {
  const mode = argv[0];
  if (mode !== "run" && mode !== "recheck" && mode !== "light" && mode !== "status") {
    process.stderr.write(`${QUALITY_GATE_USAGE}
`);
    return 2;
  }
  if ((env.wbs ?? "").length === 0) {
    process.stderr.write("quality-gate: env `wbs` is required\n");
    return 2;
  }
  if (mode === "light") {
    runLightGate(env);
  } else if (mode === "status") {
    const runDir = join(options.cwd ?? ".", ".spur", "run");
    const verdict = readReceiptStatus(join(runDir, `${env.wbs}-check-receipt.json`), env.proofDigest ?? "");
    if (verdict.reuse) {
      const line = `check.reused \u2014 full-tier receipt reused for input digest ${env.proofDigest ?? ""}
`;
      process.stdout.write(line);
      appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
    }
    process.stdout.write(`${JSON.stringify(verdict)}
`);
  } else {
    runQualityGate(mode, env);
  }
  return 0;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  workspaceHasTypecheck,
  tailLines,
  scanCoverageShortfalls,
  runShellCommand,
  runQualityGate,
  runLightGate,
  retryMessage,
  receiptFailsAtDigest,
  readReceiptStatus,
  planLightChecks,
  parseCoverageThreshold,
  main,
  lightScope,
  isTransientLock,
  extractFindings,
  buildReceipt,
  RETRY_DELAY_MS_ENV,
  RETRY_DELAY_MS_DEFAULT,
  RECEIPT_SCHEMA_VERSION,
  QUALITY_GATE_USAGE,
  MAX_GATE_ATTEMPTS,
  MAX_FINDINGS,
  LOCKED_PATTERN,
  FINDINGS_PATTERN,
  COVERAGE_ROW_PATTERN
};
