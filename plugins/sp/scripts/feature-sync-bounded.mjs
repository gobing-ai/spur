#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/feature-sync-bounded.ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
function classifySyncResult(result) {
  if (result.proposal.gateBlocked === true)
    return "blocked";
  if (result.applied === true)
    return "applied";
  if (result.proposal.from !== result.proposal.to)
    return "blocked";
  return "no-op";
}
function computeFingerprint(input) {
  const material = [
    input.featureContentHash,
    ...[...input.taskStatusVector].sort(),
    ...[...input.verdictMtimeVector].sort()
  ].join(`
`);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}
var blockedStateFile = (featureId, runDir) => `${runDir.replace(/\/$/, "")}/feature-sync-blocked-${featureId}.json`;
function serializeBlockedState(state) {
  return `${JSON.stringify(state)}
`;
}
function parseBlockedState(raw) {
  const trimmed = raw.trim();
  if (trimmed.length === 0)
    return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.featureId !== "string" || typeof parsed.inputFingerprint !== "string" || typeof parsed.proposal !== "object" || parsed.proposal === null) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function shouldSuppressBlocked(prior, currentFingerprint) {
  if (!prior)
    return { suppress: false };
  if (prior.inputFingerprint === currentFingerprint) {
    return { suppress: true, replay: prior.result };
  }
  return { suppress: false };
}
function decideBoundedSync(prior, currentFingerprint) {
  const decision = shouldSuppressBlocked(prior, currentFingerprint);
  if (decision.suppress && decision.replay) {
    return { kind: "suppress", replay: decision.replay };
  }
  return { kind: "invoke" };
}
function processSyncResult(result, currentFingerprint, persistedAt, wasSuppressed) {
  const classification = classifySyncResult(result);
  if (classification === "blocked") {
    return {
      classification,
      emit: result,
      persist: {
        featureId: result.proposal.featureId,
        inputFingerprint: currentFingerprint,
        proposal: result.proposal,
        classification,
        result,
        persistedAt
      },
      annotation: wasSuppressed ? `feature-sync-bounded: suppressed duplicate blocked sync for ${result.proposal.featureId} (inputs unchanged)` : `feature-sync-bounded: blocked proposal for ${result.proposal.featureId} — ${result.proposal.reason}`
    };
  }
  return {
    classification,
    emit: result,
    annotation: ""
  };
}
var BOUNDED_SYNC_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/feature-sync-bounded.ts <feature-id> \\
    --spur-bin <spur|bun apps/cli/src/index.ts> \\
    [--run-dir .spur/run] [--json]

Wraps 'spur feature sync <id> --json' with bounded retry-suppression: an identical
blocked proposal is reported once and suppressed until feature file content, linked
task statuses, or verdict artifact mtimes change. Applied and no-op results pass
through unchanged.

Exit: 0 = sync handled (applied / no-op / suppressed-blocked / live-blocked).`;
function defaultSpurBin() {
  if (process.env.SPUR_BIN)
    return process.env.SPUR_BIN;
  const local = fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url));
  if (existsSync(local))
    return `bun ${local}`;
  return "spur";
}
function parseBoundedSyncCliArgs(argv) {
  let featureId = "";
  let spurBin = defaultSpurBin();
  let runDir = ".spur/run";
  let json = false;
  let help = false;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h")
      help = true;
    else if (a === "--json")
      json = true;
    else if (a === "--spur-bin")
      spurBin = argv[++i] ?? spurBin;
    else if (a === "--run-dir")
      runDir = argv[++i] ?? runDir;
    else if (!a.startsWith("--") && featureId === "")
      featureId = a;
  }
  return { featureId, spurBin, runDir, json, help };
}
function runSpurJson(spurBin, args) {
  const binParts = spurBin.split(/\s+/).filter(Boolean);
  const cmd = binParts[0] ?? "spur";
  const cmdArgs = [...binParts.slice(1), ...args];
  const r = spawnSync(cmd, cmdArgs, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const decode = (b) => typeof b === "string" ? b : Buffer.from(b ?? []).toString("utf8");
  return {
    stdout: typeof r.stdout === "string" ? r.stdout : decode(r.stdout),
    stderr: typeof r.stderr === "string" ? r.stderr : decode(r.stderr),
    exitCode: r.status ?? (r.error ? 1 : 0),
    ok: (r.status ?? (r.error ? 1 : 0)) === 0
  };
}
function readFeatureContentHash(spurBin, featureId) {
  const r = runSpurJson(spurBin, ["feature", "show", featureId, "--json"]);
  if (!r.ok)
    return null;
  try {
    const parsed = JSON.parse(r.stdout);
    if (typeof parsed.content !== "string")
      return null;
    return createHash("sha256").update(parsed.content).digest("hex");
  } catch {
    return null;
  }
}
function readTaskStatusVector(spurBin, featureId) {
  const r = runSpurJson(spurBin, ["task", "list", "--feature", featureId, "--json"]);
  if (!r.ok)
    return null;
  try {
    const parsed = JSON.parse(r.stdout);
    return parsed.filter((t) => typeof t.wbs === "string" && typeof t.status === "string").map((t) => `${t.wbs}:${t.status}`).sort();
  } catch {
    return null;
  }
}
function readVerdictMtimeVector(runDir) {
  const dir = runDir.replace(/\/$/, "");
  let entries;
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith("-verdict.json"));
  } catch {
    return [];
  }
  const vector = [];
  for (const entry of entries) {
    try {
      const mtime = statSync(`${dir}/${entry}`).mtimeMs;
      vector.push(`${entry.replace("-verdict.json", "")}:${mtime}`);
    } catch {}
  }
  return vector.sort();
}
function writeBlockedState(state, path) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, serializeBlockedState(state));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`feature-sync-bounded: could not persist blocked state to ${path} — ${reason}
`);
  }
}
function readBlockedState(path) {
  try {
    if (!existsSync(path))
      return null;
    const text = readFileSync(path, "utf8");
    return parseBlockedState(text);
  } catch {
    return null;
  }
}
function runBoundedCli(argv) {
  const args = parseBoundedSyncCliArgs(argv);
  if (args.help)
    return { exitCode: 0, stdout: "", stderr: BOUNDED_SYNC_CLI_USAGE };
  if (!args.featureId)
    return { exitCode: 1, stdout: "", stderr: BOUNDED_SYNC_CLI_USAGE };
  const statePath = blockedStateFile(args.featureId, args.runDir);
  const prior = readBlockedState(statePath);
  const featureContentHash = readFeatureContentHash(args.spurBin, args.featureId);
  const taskStatusVector = readTaskStatusVector(args.spurBin, args.featureId);
  if (featureContentHash === null || taskStatusVector === null) {
    return invokeLiveSync(args, statePath);
  }
  const verdictMtimeVector = readVerdictMtimeVector(args.runDir);
  const currentFingerprint = computeFingerprint({
    featureContentHash,
    taskStatusVector,
    verdictMtimeVector
  });
  const decision = decideBoundedSync(prior, currentFingerprint);
  if (decision.kind === "suppress") {
    const processed = processSyncResult(decision.replay, currentFingerprint, new Date().toISOString(), true);
    emitResult(processed.emit, processed.annotation, args.json);
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  return invokeLiveSync(args, statePath, currentFingerprint);
}
function invokeLiveSync(args, statePath, fingerprint) {
  const r = runSpurJson(args.spurBin, ["feature", "sync", args.featureId, "--json"]);
  if (!r.ok) {
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr };
  }
  let result;
  try {
    result = JSON.parse(r.stdout);
  } catch {
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: "" };
  }
  if (!result || typeof result !== "object" || !result.proposal) {
    return {
      exitCode: r.exitCode,
      stdout: r.stdout,
      stderr: "unrecognized feature sync envelope: missing proposal"
    };
  }
  const currentFingerprint = fingerprint ?? computeFingerprint({
    featureContentHash: readFeatureContentHash(args.spurBin, args.featureId) ?? "",
    taskStatusVector: readTaskStatusVector(args.spurBin, args.featureId) ?? [],
    verdictMtimeVector: readVerdictMtimeVector(args.runDir)
  });
  const processed = processSyncResult(result, currentFingerprint, new Date().toISOString(), false);
  if (processed.persist)
    writeBlockedState(processed.persist, statePath);
  emitResult(processed.emit, processed.annotation, args.json);
  return { exitCode: 0, stdout: "", stderr: "" };
}
function emitResult(result, annotation, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}
`);
  } else {
    process.stdout.write(`${result.proposal.featureId}: ${result.proposal.from} → ${result.proposal.to} (applied=${result.applied})
`);
  }
  if (annotation.length > 0)
    process.stderr.write(`${annotation}
`);
}
{
  const { exitCode, stdout, stderr } = runBoundedCli(process.argv.slice(2));
  if (stdout)
    process.stdout.write(stdout);
  if (stderr)
    process.stderr.write(`${stderr}
`);
  process.exit(exitCode);
}
export {
  shouldSuppressBlocked,
  serializeBlockedState,
  runBoundedCli,
  processSyncResult,
  parseBoundedSyncCliArgs,
  parseBlockedState,
  defaultSpurBin,
  decideBoundedSync,
  computeFingerprint,
  classifySyncResult,
  blockedStateFile,
  BOUNDED_SYNC_CLI_USAGE
};
