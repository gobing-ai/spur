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
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/feature-verification-steps.ts
var SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
async function loadModule(spurBin) {
  const candidates = spurBin !== "" ? [spurBin] : [fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url))];
  for (const candidate of candidates) {
    const mainModule = candidate.split(/\s+/).filter(Boolean).reverse().find((t) => t.endsWith(".ts"));
    if (mainModule === undefined || !existsSync(mainModule))
      continue;
    const appEntry = resolve(dirname(mainModule), "..", "..", "..", "packages", "app", "src", "index.ts");
    if (existsSync(appEntry))
      return requireModule(appEntry);
  }
  const bundle = fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
  if (!existsSync(bundle)) {
    throw new Error("inline application bundle is missing \u2014 rebuild/install the sp plugin before running inline");
  }
  return requireModule(bundle);
}
async function requireModule(entry) {
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
    throw new Error(`application entry is missing feature-verification seams (${missing.join(", ")}) \u2014 rebuild/install the sp plugin`);
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
async function verify(featureId, runId, cmdOverride, spurBin) {
  assertSafeId("feature id", featureId);
  assertSafeId("run id", runId);
  const cwd = process.cwd();
  const mod = await loadModule(spurBin);
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
  verify(flag("--feature-id") || getEnvVar("featureId") || "", flag("--run-id") || getEnvVar("__runId") || "", flag("--cmd") || getEnvVar("verificationCmd") || "", flag("--spur-bin") || getEnvVar("spurBin") || "").then(() => process.exit(0)).catch((err) => {
    console.error(`feature-verification-steps: ${String(err)}`);
    process.exit(1);
  });
}
main();
