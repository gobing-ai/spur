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
var MAX_GATE_ATTEMPTS = 5;
var MAX_FINDINGS = 20;
var RETRY_DELAY_MS_DEFAULT = 1e4;
var RETRY_DELAY_MS_ENV = "SPUR_QUALITY_GATE_RETRY_DELAY_MS";
var LOCKED_PATTERN = /SQLiteError: database is locked|SQLite database .*is busy|SQLITE_BUSY/;
var FINDINGS_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
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
  let gateRc = 0;
  let gateAttempt = 0;
  if (mode === "recheck" && (env.gateProbeCmd ?? "").length > 0) {
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
  return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile };
}
var QUALITY_GATE_USAGE = "usage: quality-gate.ts <run|recheck>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest)";
function main(argv, env = process.env) {
  const mode = argv[0];
  if (mode !== "run" && mode !== "recheck") {
    process.stderr.write(`${QUALITY_GATE_USAGE}
`);
    return 2;
  }
  if ((env.wbs ?? "").length === 0) {
    process.stderr.write("quality-gate: env `wbs` is required\n");
    return 2;
  }
  runQualityGate(mode, env);
  return 0;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  tailLines,
  runShellCommand,
  runQualityGate,
  retryMessage,
  main,
  isTransientLock,
  extractFindings,
  RETRY_DELAY_MS_ENV,
  RETRY_DELAY_MS_DEFAULT,
  QUALITY_GATE_USAGE,
  MAX_GATE_ATTEMPTS,
  MAX_FINDINGS,
  LOCKED_PATTERN,
  FINDINGS_PATTERN
};
