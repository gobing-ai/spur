#!/usr/bin/env node
// @bun

// plugins/sp/scripts/inline-run-setup.ts
import { spawnSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/inline-run-setup.ts
function usage() {
  console.error("Usage: bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]");
  console.error("       bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]");
  console.error("       bun plugins/sp/scripts/inline-run-setup.ts --action --run-id <id> --node <state> --kind <kind> " + "--status <done|failed> --ok <true|false> --duration-ms <n> [--spur-bin <path>]");
  console.error("       bun plugins/sp/scripts/inline-run-setup.ts --close --run-id <id> --status <done|failed|paused> [--spur-bin <path>]");
  process.exit(2);
}
var SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function refuseUnsafeRunId(runId) {
  console.error(`inline-run-setup: refusing unsafe run id: ${runId}`);
  console.error("  The run id must be a single safe filename component (alphanumeric/._-, no leading dot, " + "no path separators, interpolation or traversal; same class as the task-pipeline " + "route-reason guard, task 0804 R8). Allocate a fresh run id (uuid or timestamp slug) and retry.");
  process.exit(1);
}
function resolveAppEntry(spurBin) {
  let candidates = [];
  if (spurBin !== "") {
    candidates = [spurBin];
  } else {
    candidates = [fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url))];
  }
  for (const candidate of candidates) {
    const tokens = candidate.split(/\s+/).filter(Boolean);
    const mainModule = [...tokens].reverse().find((t) => t.endsWith(".ts"));
    if (mainModule === undefined || !existsSync(mainModule))
      continue;
    const srcDir = dirname(mainModule);
    const repoRoot = resolve(srcDir, "..", "..", "..");
    const appEntry = join(repoRoot, "packages", "app", "src", "index.ts");
    if (existsSync(appEntry))
      return { entry: appEntry, portable: false };
  }
  const entry = fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
  if (!existsSync(entry)) {
    throw new Error("inline application bundle is missing \u2014 rebuild/install the sp plugin before running inline");
  }
  return { entry, portable: true };
}
async function readInstalledInventory(file, spurBin) {
  const localCli = fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url));
  const bundle = fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
  const { splitLaunchCommand } = await import(bundle);
  const launch = spurBin ? splitLaunchCommand(spurBin, 'inline-run-setup "spurBin"') : existsSync(localCli) ? { command: "bun", leadingArgs: [localCli] } : { command: "spur", leadingArgs: [] };
  if ("error" in launch)
    throw new Error(launch.error);
  const result = spawnSync(launch.command, [...launch.leadingArgs, "workflow", "show", file, "--format", "todo", "--json"], { cwd: process.cwd(), encoding: "utf8", timeout: 30000, maxBuffer: 4194304 });
  if (result.status !== 0) {
    throw new Error(`could not resolve the workflow definition with the installed CLI: ${result.error?.message ?? result.stderr}`);
  }
  const value = JSON.parse(result.stdout);
  if (value && typeof value === "object" && "ok" in value && "data" in value && value.ok === true) {
    return value.data;
  }
  return value;
}
function writeOutcome(runId, outcome) {
  const runDir = join(process.cwd(), ".spur", "run");
  if (!existsSync(runDir))
    mkdirSync(runDir, { recursive: true });
  const statePath = join(runDir, `${runId}.state.json`);
  const markdownPath = join(runDir, `${runId}.md`);
  let prior = {};
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      prior = parsed;
    }
  } catch {}
  const at = new Date().toISOString();
  const state = {
    schemaVersion: 1,
    runId,
    ...outcome.workflowName !== undefined ? { workflowName: outcome.workflowName } : {},
    ...outcome.status !== undefined ? { status: outcome.status } : {},
    startedAt: typeof prior.startedAt === "string" ? prior.startedAt : at,
    updatedAt: at,
    ...outcome.attached !== undefined ? { attached: outcome.attached } : {},
    ...outcome.definitionDigest !== undefined ? { definitionDigest: outcome.definitionDigest } : {},
    ...outcome.workflowVersion !== undefined ? { workflowVersion: outcome.workflowVersion } : {},
    ...outcome.resolvedPath !== undefined ? { resolvedPath: outcome.resolvedPath } : {},
    ...outcome.layer !== undefined ? { layer: outcome.layer } : {},
    ...outcome.workdir !== undefined ? { workdir: outcome.workdir } : {},
    ...outcome.ok === false && outcome.error !== undefined ? { error: outcome.error } : {}
  };
  const temp = `${statePath}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(state, null, 4)}
`);
    renameSync(temp, statePath);
  } catch {
    try {
      unlinkSync(temp);
    } catch {}
  }
  if (!existsSync(markdownPath)) {
    appendFileSync(markdownPath, `# spur inline run ${runId} \u2014 ${outcome.workflowName ?? "unknown workflow"} \u2014 setup ${at}
`);
  }
}
async function printFingerprint(taskFile, featureFile, spurBin) {
  const { entry } = resolveAppEntry(spurBin);
  const app = await import(entry);
  const workdir = process.cwd();
  const inputs = await app.readProofInputContents(undefined, workdir, {
    taskFile,
    ...featureFile.trim() !== "" ? { featureFile } : {}
  });
  if (!inputs.ok) {
    console.error(`inline-run-setup: FAIL \u2014 ${inputs.error}`);
    return 1;
  }
  const digest = await app.computeProofInputFingerprint({
    cwd: workdir,
    ...inputs.taskContent !== undefined ? { taskContent: inputs.taskContent } : {},
    ...inputs.featureContent !== undefined ? { featureContent: inputs.featureContent } : {}
  });
  process.stdout.write(`${digest}
`);
  return 0;
}
var CLOSE_STATUSES = new Set(["done", "failed", "paused"]);
var ACTION_STATUSES = new Set(["done", "failed"]);
function runRecordLogPath(runDir, runId) {
  const markdownPath = join(runDir, `${runId}.md`);
  const legacyLogPath = join(runDir, `${runId}.log`);
  if (existsSync(legacyLogPath) && !existsSync(markdownPath))
    return legacyLogPath;
  return markdownPath;
}
function appendTraceFailureLine(runId, detail) {
  try {
    const runDir = join(process.cwd(), ".spur", "run");
    if (!existsSync(runDir))
      mkdirSync(runDir, { recursive: true });
    const safeRunId = runId.replace(/[^A-Za-z0-9._-]/g, "_");
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    appendFileSync(runRecordLogPath(runDir, safeRunId), `[${stamp}] ${detail}
`);
  } catch {}
}
async function runTraceMode(input) {
  const operation = input.close ? "run.close" : "action.finish";
  const fail = (error) => {
    appendTraceFailureLine(input.runId, `trace-emission-failed operation=${operation} run=${input.runId}${input.node === "" ? "" : ` node=${input.node}`}${input.kind === "" ? "" : ` kind=${input.kind}`}: ${error}`);
    process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error })}
`);
    return input.close ? 1 : 0;
  };
  let projectDb;
  try {
    const { entry } = resolveAppEntry(input.spurBin);
    const app = await import(entry);
    projectDb = await app.openInlineRunProjectDb(process.cwd());
    const writer = app.createWorkflowActionTraceWriter(projectDb.adapter, (failure) => {
      const detail = failure;
      appendTraceFailureLine(input.runId, `trace-emission-failed operation=${detail.operation ?? operation} run=${input.runId}: ${detail.error ?? "unknown error"}`);
    });
    const result = input.close ? await writer.closeRun(input.runId, input.status) : await writer.recordAction({
      runId: input.runId,
      node: input.node,
      kind: input.kind,
      status: input.status,
      ok: input.ok,
      durationMs: input.durationMs
    });
    if (result.ok !== true && result.failure !== undefined) {
      const failure = result.failure;
      return fail(failure.error ?? "unknown trace emission failure");
    }
    process.stdout.write(`${JSON.stringify({ ...result, runId: input.runId })}
`);
    return 0;
  } catch (error) {
    if (input.close && error.name === "RunRowNotFoundError") {
      const message = error instanceof Error ? error.message : String(error);
      appendTraceFailureLine(input.runId, `trace-close-failed run=${input.runId}: ${message}`);
      process.stdout.write(`${JSON.stringify({ ok: false, runId: input.runId, error: message, code: "RUN_NOT_FOUND" })}
`);
      return 1;
    }
    return fail(error instanceof Error ? error.message : String(error));
  } finally {
    projectDb?.close();
  }
}
async function main() {
  if (!process.versions.bun) {
    const child = spawnSync("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit"
    });
    if (child.error)
      console.error(`inline-run-setup requires Bun on PATH: ${child.error.message}`);
    process.exit(child.status ?? 1);
  }
  let runId = "";
  let file = "";
  let fingerprint = false;
  let taskFile = "";
  let featureFile = "";
  let action = false;
  let close = false;
  let node = "";
  let kind = "";
  let status = "";
  let okRaw = "";
  let durationRaw = "";
  let spurBin = getEnvVar("SPUR_BIN") ?? "";
  const argv = process.argv.slice(2);
  for (let i = 0;i < argv.length; i++) {
    if (argv[i] === "--run-id")
      runId = argv[++i] ?? "";
    else if (argv[i] === "--file")
      file = argv[++i] ?? "";
    else if (argv[i] === "--fingerprint")
      fingerprint = true;
    else if (argv[i] === "--task-file")
      taskFile = argv[++i] ?? "";
    else if (argv[i] === "--feature-file")
      featureFile = argv[++i] ?? "";
    else if (argv[i] === "--action")
      action = true;
    else if (argv[i] === "--close")
      close = true;
    else if (argv[i] === "--node")
      node = argv[++i] ?? "";
    else if (argv[i] === "--kind")
      kind = argv[++i] ?? "";
    else if (argv[i] === "--status")
      status = argv[++i] ?? "";
    else if (argv[i] === "--ok")
      okRaw = argv[++i] ?? "";
    else if (argv[i] === "--duration-ms")
      durationRaw = argv[++i] ?? "";
    else if (argv[i] === "--spur-bin")
      spurBin = argv[++i] ?? spurBin;
  }
  if (fingerprint) {
    if (runId !== "" || file !== "" || taskFile.trim() === "")
      usage();
    process.exit(await printFingerprint(taskFile, featureFile, spurBin));
  }
  if (action || close) {
    if (action && close)
      usage();
    if (runId.trim() === "" || status.trim() === "")
      usage();
    if (!SAFE_RUN_ID_RE.test(runId))
      refuseUnsafeRunId(runId);
    if (close) {
      if (!CLOSE_STATUSES.has(status))
        usage();
      process.exit(await runTraceMode({
        runId,
        close: true,
        node: "",
        kind: "",
        status,
        ok: true,
        durationMs: 0,
        spurBin
      }));
    }
    if (node.trim() === "" || kind.trim() === "")
      usage();
    if (!ACTION_STATUSES.has(status))
      usage();
    if (okRaw !== "true" && okRaw !== "false")
      usage();
    const ok = okRaw === "true";
    const durationMs = Number(durationRaw);
    if (durationRaw.trim() === "" || !Number.isFinite(durationMs) || durationMs < 0)
      usage();
    process.exit(await runTraceMode({ runId, close: false, node, kind, status, ok, durationMs, spurBin }));
  }
  if (runId.trim() === "" || file.trim() === "")
    usage();
  if (!SAFE_RUN_ID_RE.test(runId))
    refuseUnsafeRunId(runId);
  const { entry, portable } = resolveAppEntry(spurBin);
  const app = await import(entry);
  const workdir = process.cwd();
  let inventory;
  try {
    inventory = await readInstalledInventory(file, spurBin);
  } catch (error) {
    const message = `could not resolve the workflow definition: ${error instanceof Error ? error.message : String(error)}`;
    writeOutcome(runId, { ok: false, runId, error: message });
    throw new Error(message);
  }
  const projectDb = await app.openInlineRunProjectDb(workdir);
  let exitCode = 0;
  try {
    const result = await app.createOrAttachInlineRun({
      workdir,
      getDb: async () => projectDb.adapter,
      file,
      runId,
      inventory,
      ...portable ? { embeddedSchemas: app.EMBEDDED_SPUR_SCHEMAS } : {}
    });
    writeOutcome(runId, result);
    if (!result.ok) {
      console.error(`inline-run-setup: FAIL for run ${runId}`);
      console.error(`  ${result.error}`);
      exitCode = 1;
    } else {
      console.error(`inline-run-setup: ${result.attached ? "attached" : "created"} run ${runId} (${result.workflowName}, layer ${result.layer}, digest ${result.definitionDigest}, status ${result.status})`);
    }
  } finally {
    projectDb.close();
  }
  process.exit(exitCode);
}
main().catch((e) => {
  console.error(`inline-run-setup: FAIL \u2014 ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
