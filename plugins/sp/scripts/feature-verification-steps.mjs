#!/usr/bin/env node
// @bun

// plugins/sp/scripts/feature-verification-steps.ts
import { existsSync } from "fs";
import { fileURLToPath } from "url";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/feature-verification-steps.ts
function bundleEntry() {
  return fileURLToPath(new URL("../lib/inline-run.generated.mjs", import.meta.url));
}
function sourceModeError(spurBin) {
  return new Error(`source mode: refusing to load packages/app/src/index.ts (spurBin=${JSON.stringify(spurBin)}). ` + "That entry is not the feature-verification contract surface \u2014 it does not export " + "runFeatureVerification. Fix: run in bundle mode so " + "plugins/sp/lib/inline-run.generated.mjs is loaded (omit --module-mode, or pass --module-mode bundle) " + "and regenerate that bundle if it is missing. Reinstalling the sp plugin does not add the operation to the app source entry.");
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
  const missing = ["runFeatureVerification"].filter((k) => typeof mod[k] !== "function");
  if (missing.length > 0) {
    throw new Error(`feature-verification-steps: mode=${mode} \u2014 application entry ${entry} is missing feature-verification seams (${missing.join(", ")}). ` + "Fix: the generated inline bundle is stale or incomplete \u2014 run `bun run build:bundle` in a source checkout, or reinstall the sp plugin.");
  }
  return mod;
}
async function verify(featureId, runId, cmdOverride, spurBin, mode) {
  const mod = await loadModule(spurBin, mode);
  const result = await mod.runFeatureVerification({
    workdir: process.cwd(),
    featureId,
    runId,
    cmdOverride
  });
  console.log(`feature-verification-steps: ${featureId} ${result.message}`);
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
