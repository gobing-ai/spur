#!/usr/bin/env node
// @bun

// plugins/sp/scripts/history-load.ts
import { spawnSync } from "child_process";
import { existsSync, realpathSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
var VALUE_FLAGS = {
  "--source": true,
  "--session": true,
  "--task": true,
  "--since": true,
  "--until": true
};
var BOOL_FLAGS = {
  "--report": true,
  "--dry-run": true,
  "--json": true
};
var ALL_FLAGS = { ...VALUE_FLAGS, ...BOOL_FLAGS };
function usage() {
  console.error("Usage: history-load.ts [--source <name>] [--session <id>] [--task <wbs>] " + "[--since <iso>] [--until <iso>] [--report] [--dry-run] [--json]");
  process.exit(2);
}
var FLAG_KEY = {
  "--source": "source",
  "--session": "session",
  "--task": "task",
  "--since": "since",
  "--until": "until",
  "--report": "report",
  "--dry-run": "dryRun",
  "--json": "json"
};
function parseArgs(argv) {
  const out = { report: false, dryRun: false, json: false };
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || ALL_FLAGS[arg] !== true)
      usage();
    if (BOOL_FLAGS[arg] === true) {
      out[FLAG_KEY[arg]] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--"))
      usage();
    out[FLAG_KEY[arg]] = value;
  }
  return out;
}
function defaultSpurBin() {
  if (process.env.SPUR_BIN)
    return process.env.SPUR_BIN;
  const local = fileURLToPath(new URL("../../../apps/cli/src/index.ts", import.meta.url));
  if (existsSync(local))
    return `bun ${local}`;
  return "spur";
}
function runSpur(spurBin, args) {
  const [file = "spur", ...lead] = spurBin.split(/\s+/).filter(Boolean);
  const result = spawnSync(file, [...lead, ...args], { encoding: "utf-8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
function latestArtifactPath(cwd) {
  const pointer = join(cwd, ".spur", "reports", "history", "latest.json");
  if (!existsSync(pointer))
    return null;
  try {
    return realpathSync(pointer);
  } catch {
    return null;
  }
}
function parseImportJson(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && Array.isArray(parsed.entries) ? parsed : null;
  } catch {
    return null;
  }
}
function buildAnalyzeArgs(args) {
  const out = ["history", "analyze", "--json"];
  if (args.source)
    out.push("--source", args.source);
  if (args.session)
    out.push("--session", args.session);
  if (args.task)
    out.push("--task", args.task);
  if (args.since)
    out.push("--since", args.since);
  if (args.until)
    out.push("--until", args.until);
  return out;
}
function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}
`);
}
function buildDegradedWarnings(imp) {
  const detailFor = (source) => imp?.warnings?.find((w) => w.source === source)?.detail ?? "no warning detail reported by import";
  return (imp?.entries ?? []).filter((e) => e.status === "degraded" || e.status === "failed").map((e) => ({
    source: e.source,
    status: e.status,
    parseErrors: typeof e.parseErrors === "number" ? e.parseErrors : 0,
    validationErrors: typeof e.validationErrors === "number" ? e.validationErrors : 0,
    detail: detailFor(e.source)
  }));
}
function withWarnings(payload, degraded) {
  return degraded.length > 0 ? { ...payload, warnings: degraded } : payload;
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  const spurBin = defaultSpurBin();
  const cwd = process.cwd();
  const importArgs = ["history", "import", "--json"];
  if (args.source)
    importArgs.push("--source", args.source);
  if (args.dryRun)
    importArgs.push("--dry-run");
  const importResult = runSpur(spurBin, importArgs);
  const imp = parseImportJson(importResult.stdout);
  if (importResult.status !== 0 && importResult.status !== 2) {
    const failed = (imp?.entries ?? []).filter((e) => e.status !== "ok" && e.status !== "empty").map((e) => e.source);
    const warning = imp?.warnings?.find((w) => w.code === "source-failed" || w.code === "source-degraded");
    const detail = warning?.detail || importResult.stderr.trim() || "import exited non-zero";
    const message = failed.length > 0 ? `import failed for source(s): ${failed.join(", ")} \u2014 ${detail}` : detail;
    if (args.json) {
      emitJson({
        import: imp ?? { entries: [], exitCode: importResult.status },
        artifact: null,
        reported: false,
        status: "error",
        message
      });
    } else {
      console.error(message);
    }
    process.exit(importResult.status);
  }
  const degraded = importResult.status === 2 ? buildDegradedWarnings(imp) : [];
  if (degraded.length > 0 && !args.json) {
    console.error("WARNING: import fan-out degraded \u2014 proceeding with the healthy sources:");
    for (const w of degraded) {
      console.error(`  ${w.source}: status=${w.status} parseErrors=${w.parseErrors} ` + `validationErrors=${w.validationErrors} \u2014 ${w.detail}`);
    }
  }
  if (args.dryRun) {
    const analyzeArgs = buildAnalyzeArgs(args);
    const sequence = [`spur history import --json${args.source ? ` --source ${args.source}` : ""} --dry-run`];
    sequence.push(`spur ${analyzeArgs.join(" ")}`);
    if (args.report)
      sequence.push("spur history report --mode forensics <artifact-path>");
    if (args.json) {
      emitJson(withWarnings({
        import: imp ?? { entries: [], exitCode: importResult.status },
        artifact: null,
        reported: false,
        status: "dry-run",
        wouldRun: sequence
      }, degraded));
    } else {
      console.log("[dry-run] would run:");
      for (const line of sequence)
        console.log(`  ${line}`);
    }
    process.exit(0);
  }
  const analyzeResult = runSpur(spurBin, buildAnalyzeArgs(args));
  if (analyzeResult.status !== 0) {
    const message = analyzeResult.stderr.trim() || `history analyze exited non-zero (${analyzeResult.status})`;
    if (args.json) {
      emitJson({
        import: imp ?? { entries: [], exitCode: 0 },
        artifact: null,
        reported: false,
        status: "error",
        message
      });
    } else {
      console.error(message);
    }
    process.exit(analyzeResult.status);
  }
  let artifact = null;
  try {
    artifact = JSON.parse(analyzeResult.stdout);
  } catch {}
  const artifactPath = latestArtifactPath(cwd);
  const messages = artifact?.totals?.messages;
  if (typeof messages === "number" && messages === 0) {
    const message = "history analyze: window matched zero messages \u2014 nothing to report";
    if (args.json) {
      emitJson({
        import: imp ?? { entries: [], exitCode: 0 },
        artifact: artifactPath,
        reported: false,
        status: "empty-window",
        message
      });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
  if (artifactPath === null) {
    const message = "history analyze completed but no artifact pointer (.spur/reports/history/latest.json) was found";
    if (args.json) {
      emitJson({
        import: imp ?? { entries: [], exitCode: 0 },
        artifact: null,
        reported: false,
        status: "error",
        message
      });
    } else {
      console.error(message);
    }
    process.exit(1);
  }
  let reported = false;
  let reportText = "";
  if (args.report) {
    const reportResult = runSpur(spurBin, ["history", "report", "--mode", "forensics", artifactPath]);
    reported = reportResult.status === 0;
    reportText = reportResult.stdout;
    if (reportResult.status !== 0) {
      const message = reportResult.stderr.trim() || `history report exited non-zero (${reportResult.status})`;
      if (args.json) {
        emitJson({
          import: imp ?? { entries: [], exitCode: 0 },
          artifact: artifactPath,
          reported: false,
          status: "error",
          message
        });
      } else {
        console.error(message);
      }
      process.exit(reportResult.status);
    }
  }
  const count = (imp?.entries ?? []).reduce((sum, e) => sum + (typeof e.messages === "number" ? e.messages : 0), 0);
  if (args.json) {
    const payload = withWarnings({
      import: imp ?? { entries: [], exitCode: 0 },
      artifact: artifactPath,
      reported,
      status: "ok"
    }, degraded);
    if (args.report)
      payload.report = reportText;
    emitJson(payload);
  } else {
    console.log(`history import: ${count} records`);
    console.log(`artifact: ${artifactPath}`);
    if (args.report)
      process.stdout.write(reportText);
  }
}
main();
