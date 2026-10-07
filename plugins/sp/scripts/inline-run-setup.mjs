#!/usr/bin/env node
// @bun

// plugins/sp/scripts/inline-run-setup.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/inline-run-setup.ts
function usage() {
  const text = [
    "Usage: bun plugins/sp/scripts/inline-run-setup.ts --run-id <id> --file <definition> [--spur-bin <path>]",
    "       bun plugins/sp/scripts/inline-run-setup.ts --fingerprint --task-file <path> [--feature-file <path>] [--spur-bin <path>]",
    "       bun plugins/sp/scripts/inline-run-setup.ts --action --run-id <id> --node <state> --kind <kind> --status <done|failed> --ok <true|false> --duration-ms <n> [--estimated] [--spur-bin <path>]",
    "       bun plugins/sp/scripts/inline-run-setup.ts --actions-file <json-file> --run-id <id> [--spur-bin <path>]  (1007 R5 batch trace emission)",
    "       bun plugins/sp/scripts/inline-run-setup.ts --close --run-id <id> --status <done|failed|paused> [--reason <terminal-reason>] [--spur-bin <path>]",
    "       bun plugins/sp/scripts/inline-run-setup.ts --persist-out --from <worktree-path> [--task-file <path>]... [--spur-bin <path>]",
    "       terminal-reason is a closed enum (0937 R2): done, paused-operator, failed-check, failed-agent, failed-timeout, failed-guard, cancelled, interrupted, retry-exhausted",
    "       close defaults (1051 AC1): --status done \u2192 reason done, --status paused \u2192 reason paused-operator; --status failed requires an explicit --reason",
    "       bun plugins/sp/scripts/inline-run-setup.ts --decide --run-id <id> --node <state> --options-json <file> [--spur-bin <path>]"
  ].join(`
`);
  console.error(text);
  process.exit(2);
}
var SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function refuseUnsafeRunId(runId) {
  console.error(`inline-run-setup: refusing unsafe run id: ${runId}`);
  console.error("  The run id must be a single safe filename component (alphanumeric/._-, no leading dot, no path separators, interpolation or traversal; same class as the task-pipeline route-reason guard, task 0804 R8). Allocate a fresh run id (uuid or timestamp slug) and retry.");
  process.exit(1);
}
function resolveAppEntry(spurBin) {
  const fallback = fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url));
  const candidates = spurBin !== "" ? [spurBin] : [fallback];
  for (const candidate of candidates) {
    const tokens = candidate.split(/\s+/).filter(Boolean);
    const mainModule = [...tokens].reverse().find((t) => t.endsWith(".ts"));
    if (mainModule === undefined || !existsSync(mainModule))
      continue;
    const repoRoot = resolve(dirname(mainModule), "..", "..", "..");
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
var TERMINAL_REASONS = new Set([
  "done",
  "paused-operator",
  "failed-check",
  "failed-agent",
  "failed-timeout",
  "failed-guard",
  "cancelled",
  "interrupted",
  "retry-exhausted"
]);
async function main() {
  if (!process.versions.bun) {
    const child = spawnSync("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit"
    });
    if (child.error)
      console.error(`inline-run-setup requires Bun on PATH: ${child.error.message}`);
    process.exit(child.status ?? 1);
  }
  const flags = new Map;
  let fingerprint = false, action = false, close = false, decide = false, persistOut = false, estimated = false;
  const taskFiles = [];
  let spurBin = getEnvVar("SPUR_BIN") ?? "";
  const argv = process.argv.slice(2);
  for (let i = 0;i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--fingerprint")
      fingerprint = true;
    else if (flag === "--action")
      action = true;
    else if (flag === "--close")
      close = true;
    else if (flag === "--decide")
      decide = true;
    else if (flag === "--persist-out")
      persistOut = true;
    else if (flag === "--estimated")
      estimated = true;
    else if (flag === "--task-file")
      taskFiles.push(argv[++i] ?? "");
    else if (flag === "--spur-bin")
      spurBin = argv[++i] ?? spurBin;
    else if (flag !== undefined)
      flags.set(flag, argv[++i] ?? "");
  }
  const runId = flags.get("--run-id") ?? "";
  const file = flags.get("--file") ?? "";
  const featureFile = flags.get("--feature-file") ?? "";
  const from = flags.get("--from") ?? "";
  const optionsJson = flags.get("--options-json") ?? "";
  const node = flags.get("--node") ?? "";
  const kind = flags.get("--kind") ?? "";
  const status = flags.get("--status") ?? "";
  const reason = flags.get("--reason") ?? "";
  const okRaw = flags.get("--ok") ?? "";
  const durationRaw = flags.get("--duration-ms") ?? "";
  const actionsFile = flags.get("--actions-file") ?? "";
  if (estimated && !action)
    usage();
  if (fingerprint) {
    if (runId !== "" || file !== "" || taskFiles.length !== 1 || (taskFiles[0] ?? "").trim() === "")
      usage();
    const app2 = await import(resolveAppEntry(spurBin).entry);
    process.exit(await app2.runInlineRunFingerprint({ taskFile: taskFiles[0] ?? "", featureFile }));
  }
  if (actionsFile !== "") {
    if (action || close || fingerprint || decide || persistOut || file !== "" || taskFiles.length > 0)
      usage();
    if (runId.trim() === "" || status !== "" || node !== "" || kind !== "")
      usage();
    if (okRaw !== "" || durationRaw !== "")
      usage();
    if (!SAFE_RUN_ID_RE.test(runId))
      refuseUnsafeRunId(runId);
    const app2 = await import(resolveAppEntry(spurBin).entry);
    process.exit(await app2.runInlineRunTraceBatch({ runId, actionsFile }));
  }
  if (decide) {
    if (action || close || fingerprint || file !== "" || taskFiles.length > 0)
      usage();
    if (runId.trim() === "" || node.trim() === "" || optionsJson.trim() === "")
      usage();
    if (!SAFE_RUN_ID_RE.test(runId))
      refuseUnsafeRunId(runId);
    try {
      const { entry: entry2, portable: portable2 } = resolveAppEntry(spurBin);
      const app2 = await import(entry2);
      const bundlePath = fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
      const lib = await import(bundlePath);
      const loadOpts = portable2 ? { embeddedSchemas: lib.EMBEDDED_SPUR_SCHEMAS } : undefined;
      const [enabled, spurConfig] = await Promise.all([
        lib.resolveDecideDecisionMakerEnabled(process.cwd(), loadOpts),
        lib.loadSpurConfig(process.cwd(), loadOpts)
      ]);
      process.exit(await app2.runInlineRunDecide({ runId, node, optionsFile: optionsJson, enabled, spurConfig }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify({ ok: false, runId, error: message })}
`);
      process.exit(1);
    }
  }
  if (persistOut) {
    if (fingerprint || decide || action || close || runId !== "" || file !== "")
      usage();
    if (from.trim() === "" || taskFiles.some((taskFile) => taskFile.trim() === ""))
      usage();
    const app2 = await import(resolveAppEntry(spurBin).entry);
    process.exit(await app2.runInlineRunPersistOut({ from, taskFiles }));
  }
  if (action || close) {
    if (action && close)
      usage();
    if (runId.trim() === "" || status.trim() === "")
      usage();
    if (!SAFE_RUN_ID_RE.test(runId))
      refuseUnsafeRunId(runId);
    const app2 = await import(resolveAppEntry(spurBin).entry);
    if (close) {
      if (!app2.isInlineRunCloseStatus(status))
        usage();
      if (reason.trim() === "" ? status === "failed" : !TERMINAL_REASONS.has(reason))
        usage();
      process.exit(await app2.runInlineRunTrace({
        runId,
        close: true,
        node: "",
        kind: "",
        status,
        ok: true,
        durationMs: 0,
        ...reason.trim() === "" ? {} : { reason }
      }));
    }
    if (node.trim() === "" || kind.trim() === "")
      usage();
    if (!app2.isInlineRunActionStatus(status))
      usage();
    if (okRaw !== "true" && okRaw !== "false")
      usage();
    const durationMs = Number(durationRaw);
    if (durationRaw.trim() === "" || !Number.isFinite(durationMs) || durationMs < 0)
      usage();
    process.exit(await app2.runInlineRunTrace({
      runId,
      close: false,
      node,
      kind,
      status,
      ok: okRaw === "true",
      durationMs,
      ...estimated ? { estimated: true } : {}
    }));
  }
  if (runId.trim() === "" || file.trim() === "")
    usage();
  if (!SAFE_RUN_ID_RE.test(runId))
    refuseUnsafeRunId(runId);
  const { entry, portable } = resolveAppEntry(spurBin);
  const app = await import(entry);
  let inventory;
  try {
    inventory = await app.readInstalledInventory({
      file,
      spurBin,
      localCli: fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url))
    });
  } catch (error) {
    const message = `could not resolve the workflow definition: ${error instanceof Error ? error.message : String(error)}`;
    app.writeInlineRunOutcome(runId, { ok: false, runId, error: message });
    throw new Error(message);
  }
  process.exit(await app.runInlineRunSetup({
    runId,
    file,
    inventory,
    ...portable ? { embeddedSchemas: app.EMBEDDED_SPUR_SCHEMAS } : {}
  }));
}
main().catch((e) => {
  console.error(`inline-run-setup: FAIL \u2014 ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
