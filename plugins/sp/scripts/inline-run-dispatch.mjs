#!/usr/bin/env node
// @bun

// plugins/sp/scripts/inline-run-dispatch.ts
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/lib/inline-run-app.ts
async function loadInlineApp(spurBin, resolveAppEntry, required) {
  const { entry, portable } = resolveAppEntry(spurBin);
  const app = await import(entry);
  const missing = portable ? required.filter((name) => typeof app[name] !== "function") : [];
  if (missing.length > 0) {
    throw new Error(`inline application bundle ${entry} is older than its scripts — missing ${missing.join(", ")}. Reinstall sp with a superskill release that stages lib/ (commit b42961b), or pass --spur-bin <spur checkout>/apps/cli/src/index.ts.`);
  }
  return { app, portable };
}

// plugins/sp/scripts/inline-run-dispatch.ts
function usage() {
  console.error([
    "Usage: bun plugins/sp/scripts/inline-run-dispatch.ts --attribution --run-id <id> --stage <state> [--executor <name>] [--agent <name>] [--model <m>] [--spur-bin <path>]",
    "       bun plugins/sp/scripts/inline-run-dispatch.ts --dispatch-failure --run-id <id> --stage <state> --decision <escalate|stop|host-inline> (--text <record> | --text-file <path>) [--executor <name>] [--agent <name>] [--model <m>] [--spur-bin <path>]",
    "       --attribution writes .spur/run/<run-id>-attribution.jsonl; an omitted/empty --executor records the explicit no-attribution marker.",
    "       --dispatch-failure classifies the record upstream, writes .spur/run/<run-id>-dispatch-fallback.json, and carries an attributed capacity exhaustion onto the durable availability path."
  ].join(`
`));
  process.exit(2);
}
var SAFE_RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
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
async function main() {
  if (!process.versions.bun) {
    const child = spawnSync("bun", [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: "inherit"
    });
    if (child.error)
      console.error(`inline-run-dispatch requires Bun on PATH: ${child.error.message}`);
    process.exit(child.status ?? 1);
  }
  const flags = new Map;
  let attribution = false;
  let dispatchFailure = false;
  let spurBin = getEnvVar("SPUR_BIN") ?? "";
  const argv = process.argv.slice(2);
  for (let i = 0;i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--attribution")
      attribution = true;
    else if (flag === "--dispatch-failure")
      dispatchFailure = true;
    else if (flag === "--spur-bin")
      spurBin = argv[++i] ?? spurBin;
    else if (flag !== undefined)
      flags.set(flag, argv[++i] ?? "");
  }
  const runId = flags.get("--run-id") ?? "";
  const stage = flags.get("--stage") ?? "";
  const decision = flags.get("--decision") ?? "";
  const text = flags.get("--text") ?? "";
  const textFile = flags.get("--text-file") ?? "";
  const executor = flags.get("--executor") ?? "";
  const agent = flags.get("--agent") ?? "";
  const model = flags.get("--model") ?? "";
  if (attribution === dispatchFailure)
    usage();
  if (runId.trim() === "" || stage.trim() === "" || !SAFE_RUN_ID_RE.test(runId))
    usage();
  const identity = {
    executor: executor.trim() === "" ? null : executor,
    agent: agent.trim() === "" ? null : agent,
    ...model.trim() === "" ? {} : { model }
  };
  const { app, portable } = await loadInlineApp(spurBin, resolveAppEntry, [
    "recordInlineRunAttribution",
    "runInlineRunDispatchFailure"
  ]);
  if (attribution) {
    app.recordInlineRunAttribution(process.cwd(), runId, {
      stage,
      ...identity,
      observedAt: new Date().toISOString()
    });
    process.stdout.write(`${JSON.stringify({ ok: true, runId, stage })}
`);
    process.exit(0);
  }
  if (decision.trim() === "" || text === "" === (textFile === ""))
    usage();
  const { app: lib } = await loadInlineApp(spurBin, () => ({ entry: fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url)), portable }), ["loadSpurConfig"]);
  const spurConfig = await lib.loadSpurConfig(process.cwd(), portable ? { embeddedSchemas: lib.EMBEDDED_SPUR_SCHEMAS } : undefined);
  process.exit(await app.runInlineRunDispatchFailure({
    runId,
    stage,
    decision,
    ...text === "" ? { textFile } : { text },
    ...identity,
    spurConfig
  }));
}
main().catch((e) => {
  console.error(`inline-run-dispatch: FAIL \u2014 ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
