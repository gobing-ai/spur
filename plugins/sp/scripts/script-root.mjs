#!/usr/bin/env node
// @bun

// plugins/sp/scripts/script-root.ts
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/script-root.ts
var SOURCE_REPO_MARKER = join("config", "plugin-scripts.json");
var PROJECT_SCRIPTS_DIR = join("plugins", "sp", "scripts");
var SCRIPT_ROOT_TWIN_REL = "script-root.mjs";
function defaultResolveScript(cwd) {
  return (rel) => {
    const run = spawnSync("superskill", ["script", "path", "sp", rel, "--json"], {
      cwd,
      encoding: "utf8",
      env: getEnvVars()
    });
    if (run.status !== 0 || !run.stdout)
      return null;
    const lastLine = run.stdout.trim().split(`
`).pop() ?? "";
    try {
      const parsed = JSON.parse(lastLine);
      return typeof parsed.path === "string" && parsed.path.length > 0 ? parsed : null;
    } catch {
      return null;
    }
  };
}
function digestScriptSet(dir, cwd) {
  const abs = cwd ? join(cwd, dir) : dir;
  const names = readdirSync(abs).filter((name) => {
    try {
      return statSync(join(abs, name)).isFile();
    } catch {
      return false;
    }
  }).sort();
  const list = names.map((name) => `${name}:${createHash("sha256").update(readFileSync(join(abs, name))).digest("hex")}`);
  return `sha256:${createHash("sha256").update(list.join(`
`)).digest("hex")}`;
}
function runScriptRoot(env, options = {}) {
  const cwd = options.cwd;
  const runId = env.__runId ?? env.runId ?? "";
  const relResult = join(".spur", "run", `${runId}-script-root.json`);
  const abs = (p) => cwd ? join(cwd, p) : p;
  const warn = options.warn ?? ((message) => void process.stderr.write(`${message}
`));
  mkdirSync(abs(join(".spur", "run")), { recursive: true });
  const write = (row) => {
    writeFileSync(abs(relResult), `${JSON.stringify(row)}
`);
    return { ...row, resultFile: relResult, exitCode: 0 };
  };
  if (existsSync(abs(SOURCE_REPO_MARKER))) {
    try {
      return write({
        mode: "source-repo",
        source: "project",
        dir: PROJECT_SCRIPTS_DIR,
        scriptSetDigest: digestScriptSet(PROJECT_SCRIPTS_DIR, cwd)
      });
    } catch (error) {
      return write({ mode: "unresolved", error: `source-repo digest failed: ${String(error)}` });
    }
  }
  if (existsSync(abs(PROJECT_SCRIPTS_DIR))) {
    warn(`script-root: ignoring vendored ${PROJECT_SCRIPTS_DIR}/ (no ${SOURCE_REPO_MARKER} marker) \u2014 ` + `steps resolve the installed twin via 'superskill script path sp <rel>'`);
  }
  const resolve = options.resolveScript ?? defaultResolveScript(cwd);
  const resolved = resolve(SCRIPT_ROOT_TWIN_REL);
  if (!resolved?.path) {
    return write({
      mode: "unresolved",
      error: `'superskill script path sp ${SCRIPT_ROOT_TWIN_REL}' resolved nothing`
    });
  }
  const dir = dirname(resolved.path);
  try {
    return write({
      mode: "installed",
      source: resolved.source ?? "unknown",
      dir,
      scriptSetDigest: digestScriptSet(dir)
    });
  } catch (error) {
    return write({ mode: "unresolved", error: `installed digest failed: ${String(error)}` });
  }
}
var SCRIPT_ROOT_USAGE = "usage: script-root --run-id <id>";
function main(argv, env = getEnvVars(), options = {}) {
  let runId = env.__runId ?? "";
  for (let i = 0;i < argv.length; i++) {
    if (argv[i] === "--run-id") {
      runId = argv[i + 1] ?? "";
      i++;
      continue;
    }
    process.stderr.write(`${SCRIPT_ROOT_USAGE}
`);
    return 2;
  }
  return runScriptRoot({ ...env, __runId: runId }, options).exitCode;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  runScriptRoot,
  main,
  digestScriptSet,
  SOURCE_REPO_MARKER,
  SCRIPT_ROOT_USAGE,
  SCRIPT_ROOT_TWIN_REL,
  PROJECT_SCRIPTS_DIR
};
