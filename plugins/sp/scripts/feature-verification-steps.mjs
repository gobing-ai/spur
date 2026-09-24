#!/usr/bin/env node
// @bun

// plugins/sp/scripts/feature-verification-steps.ts
import { spawnSync } from "child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/feature-verification-steps.ts
var SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function bundleEntry() {
  return fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
}
function sourceModeError(spurBin) {
  return new Error(`source mode: refusing to load packages/app/src/index.ts (spurBin=${JSON.stringify(spurBin)}). ` + "That entry is not the feature-verification contract surface \u2014 it does not export " + "splitLaunchCommand / ArtifactDao. Fix: run in bundle mode so " + "plugins/sp/lib/inline-run.generated.mjs is loaded (omit --module-mode, or pass --module-mode bundle) " + "and regenerate that bundle if it is missing. Reinstalling the sp plugin does not add these seams to the app source entry.");
}
function resolveModuleMode(raw) {
  if (raw === "" || raw === "bundle")
    return "bundle";
  if (raw === "source")
    return "source";
  throw new Error(`unknown --module-mode ${JSON.stringify(raw)}; expected "source" or "bundle"`);
}
async function loadModule(spurBin, mode) {
  if (mode === "source")
    throw sourceModeError(spurBin);
  const bundle = bundleEntry();
  if (!existsSync(bundle)) {
    throw new Error(`feature-verification-steps: mode=bundle \u2014 the generated inline bundle is missing at ${bundle}` + `${spurBin === "" ? "" : ` (spurBin=${spurBin})`}. ` + "Fix: in a source checkout run `bun run build:bundle`; for an installed plugin reinstall it.");
  }
  return requireModule(bundle, mode);
}
async function requireModule(entry, mode) {
  const mod = await import(entry);
  const missing = [
    "startFeatureVerificationReceipt",
    "completeFeatureVerificationReceipt",
    "captureFeatureReceiptDigest",
    "resolveWorkflowDefinition",
    "splitLaunchCommand",
    "openInlineRunProjectDb",
    "ArtifactDao"
  ].filter((k) => typeof mod[k] !== "function");
  if (missing.length > 0) {
    throw new Error(`feature-verification-steps: mode=${mode} \u2014 application entry ${entry} is missing feature-verification seams (${missing.join(", ")}). ` + "Fix: the generated inline bundle is stale or incomplete \u2014 run `bun run build:bundle` in a source checkout, or reinstall the sp plugin.");
  }
  return mod;
}
function assertSafeId(kind, id) {
  if (!SAFE_ID_RE.test(id) || id.includes("..")) {
    throw new Error(`refusing unsafe ${kind}: ${id}`);
  }
}
function findFeatureFile(featureDir, featureId) {
  if (!existsSync(featureDir))
    return;
  const name = readdirSync(featureDir).find((n) => n.startsWith(`${featureId}_`) && n.endsWith(".md"));
  return name === undefined ? undefined : join(featureDir, name);
}
var nodeFsShim = {
  ensureDir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  writeFile: (path, body) => {
    writeFileSync(path, body);
  },
  rename: (src, dest) => {
    renameSync(src, dest);
  },
  readFile: (path) => {
    return readFileSync(path, "utf8");
  }
};
async function verify(featureId, runId, cmdOverride, spurBin, mode) {
  assertSafeId("feature id", featureId);
  assertSafeId("run id", runId);
  const cwd = process.cwd();
  const mod = await loadModule(spurBin, mode);
  const runDir = join(cwd, ".spur", "run");
  mkdirSync(runDir, { recursive: true });
  const selected = await mod.resolveWorkflowDefinition(cwd, "feature-verification");
  const vars = selected.workflow.vars;
  const configuredCmd = typeof vars?.verificationCmd === "string" && vars.verificationCmd.length > 0 ? vars.verificationCmd : "bun run spur-check-feature";
  const effectiveCmd = cmdOverride !== "" ? cmdOverride : configuredCmd;
  const featureFile = findFeatureFile(join(cwd, "docs", "features"), featureId);
  if (featureFile === undefined) {
    throw new Error(`feature ${featureId} not found under ${join(cwd, "docs", "features")}`);
  }
  const featureContent = readFileSync(featureFile, "utf8");
  const learningsPath = join(cwd, ".spur", "context", "learnings.md");
  const learningsContent = existsSync(learningsPath) ? readFileSync(learningsPath, "utf8") : undefined;
  const beforeDigest = await mod.captureFeatureReceiptDigest(cwd, featureContent, learningsContent);
  const receipt = await mod.startFeatureVerificationReceipt(nodeFsShim, runDir, {
    featureId,
    runId,
    workdir: cwd,
    verifier: {
      name: "feature-verification",
      sourcePath: selected.path,
      layer: selected.layer,
      definitionDigest: selected.digest
    },
    verificationCmd: effectiveCmd,
    inputDigest: beforeDigest
  });
  const db = await mod.openInlineRunProjectDb(cwd);
  try {
    await new mod.ArtifactDao(db.adapter).record({
      runId,
      path: join(runDir, `${runId}-feature-verification.json`),
      kind: "feature-verification"
    });
  } finally {
    db.close();
  }
  const logPath = join(runDir, `${runId}-feature-verification.log`);
  const launch = mod.splitLaunchCommand(effectiveCmd, "feature-verification verificationCmd");
  if ("error" in launch) {
    await mod.completeFeatureVerificationReceipt(nodeFsShim, runDir, receipt, {
      status: "FAIL",
      inputDigest: beforeDigest
    });
    console.log(`feature-verification-steps: ${featureId} verification FAIL (${launch.error})`);
    return;
  }
  const logFd = openSync(logPath, "a");
  try {
    const result = spawnSync(launch.command, launch.leadingArgs, {
      cwd,
      stdio: ["ignore", logFd, logFd],
      timeout: 14400000
    });
    const exit = result.status ?? 1;
    const afterDigest = await mod.captureFeatureReceiptDigest(cwd, featureContent, learningsContent);
    const status = exit === 0 && afterDigest === beforeDigest ? "PASS" : "FAIL";
    await mod.completeFeatureVerificationReceipt(nodeFsShim, runDir, receipt, { status, inputDigest: afterDigest });
    console.log(`feature-verification-steps: ${featureId} verification ${status} (run ${runId}, log ${logPath})`);
  } finally {
    closeSync(logFd);
  }
}
function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && i + 1 < args.length ? args[i + 1] ?? "" : "";
  };
  if (command !== "verify") {
    console.error("Usage: feature-verification-steps.ts verify --feature-id <id> --run-id <id> [--cmd <command>]");
    process.exit(2);
  }
  verify(flag("--feature-id") || getEnvVar("featureId") || "", flag("--run-id") || getEnvVar("__runId") || "", flag("--cmd") || getEnvVar("verificationCmd") || "", flag("--spur-bin") || getEnvVar("spurBin") || "", resolveModuleMode(flag("--module-mode"))).then(() => process.exit(0)).catch((err) => {
    console.error(`feature-verification-steps: ${String(err)}`);
    process.exit(1);
  });
}
main();
