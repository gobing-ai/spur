#!/usr/bin/env node
// @bun
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/daily-summary/daily-summary.ts
import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readlinkSync, writeFileSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";

// plugins/sp/scripts/daily-summary/logger.ts
var state = { console: true, file: false };
function emit(stream, message) {
  if (!state.console)
    return;
  console[stream](message);
}
var logger = {
  info: (message) => emit("log", message),
  warn: (message) => emit("warn", message),
  error: (message) => emit("error", message)
};

// plugins/sp/scripts/daily-summary/daily-summary.ts
var DAILY_DIR = "docs/daily";
var DEFAULT_DATE = "today";
function parseArgs(argv = process.argv.slice(2)) {
  const args = argv;
  const options = {
    date: DEFAULT_DATE,
    dryRun: false,
    skipGit: false,
    skipCcusage: false
  };
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    if (arg === "--date" && i + 1 < args.length) {
      options.date = args[++i];
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--output" && i + 1 < args.length) {
      options.outputPath = args[++i];
    } else if (arg === "--no-git") {
      options.skipGit = true;
    } else if (arg === "--no-ccusage") {
      options.skipCcusage = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (options.date === "today") {
    options.date = todayLocal();
  } else if (options.date === "yesterday") {
    options.date = yesterdayLocal();
  }
  return options;
}
function printUsage() {
  console.log(`
sp:daily-summary \u2014 Generate daily summary reports

Usage: daily-summary.ts [options]

Options:
  --date YYYY-MM-DD     Date for summary (default: today, also: yesterday)
  --dry-run             Show summary without writing file
  --output <path>       Write to custom path
  --no-git              Skip git history collection
  --no-ccusage          Skip token usage collection
  --help, -h            Show this help

Examples:
  daily-summary.ts                        # Today's summary
  daily-summary.ts --date yesterday     # Yesterday's summary
  daily-summary.ts --dry-run            # Preview without writing
`);
}
function todayLocal() {
  const proc = spawnSync("date", ["+%Y-%m-%d"], { encoding: "utf8" });
  return (proc.stdout ?? "").trim();
}
function yesterdayLocal() {
  const epochProc = spawnSync("date", ["+%s"], { encoding: "utf8" });
  const epoch = parseInt((epochProc.stdout ?? "").trim(), 10);
  const yesterdayEpoch = epoch - 86400;
  let proc = spawnSync("date", ["-r", String(yesterdayEpoch), "+%Y-%m-%d"], { encoding: "utf8" });
  if ((proc.status ?? 1) !== 0) {
    proc = spawnSync("date", ["-d", `@${yesterdayEpoch}`, "+%Y-%m-%d"], { encoding: "utf8" });
  }
  return (proc.stdout ?? "").trim();
}
function getDateRange(dateStr) {
  const date = new Date(`${dateStr}T00:00:00`);
  const start = `${dateStr} 00:00:00`;
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 1);
  const end = `${endDate.toISOString().slice(0, 10)} 00:00:00`;
  return { start, end };
}
var defaultProcessSpawner = (cmd, args, env) => {
  return new Promise((resolve2, reject) => {
    try {
      const proc = spawn(cmd, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: env ?? process.env
      });
      const stdoutChunks = [];
      const stderrChunks = [];
      proc.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
      proc.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
      proc.on("close", (exitCode) => {
        resolve2({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: exitCode ?? 0
        });
      });
      proc.on("error", (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
};
var processSpawner = defaultProcessSpawner;
function setProcessSpawner(next) {
  processSpawner = next ?? defaultProcessSpawner;
}
async function getCcusageData(date) {
  try {
    const env = { ...process.env };
    const ccusageCheck = await processSpawner("ccusage", ["--version"], env);
    if (ccusageCheck.exitCode !== 0) {
      return null;
    }
    const since = `${date}T00:00:00`;
    const until = `${date}T23:59:59`;
    const proc = await processSpawner("ccusage", ["daily", "--since", since, "--until", until, "--json"], env);
    if (proc.exitCode !== 0) {
      logger.warn(`ccusage error: ${proc.stderr}`);
      return null;
    }
    const data = JSON.parse(proc.stdout);
    return data;
  } catch (error) {
    logger.warn(`Failed to get ccusage data: ${error}`);
    return null;
  }
}
async function getGitCommits(date) {
  try {
    const { start, end } = getDateRange(date);
    const proc = await processSpawner("git", [
      "log",
      "--since",
      start,
      "--until",
      end,
      "--pretty=format:%H|%ad|%s",
      "--date=iso",
      "--numstat"
    ]);
    if (proc.exitCode !== 0) {
      logger.warn("Failed to get git commits");
      return [];
    }
    const commits = [];
    const lines = proc.stdout.trim().split(`
`);
    let currentCommit = null;
    for (const line of lines) {
      if (!line.trim())
        continue;
      if (line.includes("|")) {
        const parts = line.split("|");
        if (parts.length >= 3) {
          if (currentCommit?.hash) {
            commits.push(currentCommit);
          }
          currentCommit = {
            hash: parts[0],
            date: parts[1],
            message: parts[2],
            filesChanged: 0,
            insertions: 0,
            deletions: 0
          };
        }
      } else if (currentCommit && line.includes("\t")) {
        const parts = line.split("\t");
        if (parts.length >= 3) {
          const insertions = parseInt(parts[0], 10) || 0;
          const deletions = parseInt(parts[1], 10) || 0;
          currentCommit.filesChanged = (currentCommit.filesChanged ?? 0) + 1;
          currentCommit.insertions = (currentCommit.insertions ?? 0) + insertions;
          currentCommit.deletions = (currentCommit.deletions ?? 0) + deletions;
        }
      }
    }
    if (currentCommit?.hash) {
      commits.push(currentCommit);
    }
    return commits;
  } catch (error) {
    logger.warn(`Failed to get git commits: ${error}`);
    return [];
  }
}
async function promptUser() {
  if (process.env.SP_DAILY_SUMMARY_NO_PROMPT === "1") {
    return { learnings: "", issuesFixed: "", pending: "" };
  }
  if (process.env.RD3_DAILY_SUMMARY_NO_PROMPT === "1") {
    logger.warn("[deprecate] RD3_DAILY_SUMMARY_NO_PROMPT is deprecated; use SP_DAILY_SUMMARY_NO_PROMPT");
    return { learnings: "", issuesFixed: "", pending: "" };
  }
  console.log(`
\uD83D\uDCCA Daily Summary \u2014 ${todayLocal()}`);
  console.log("\u2550".repeat(50));
  console.log(`
Please provide the following (press Enter to skip):
`);
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const buffered = Buffer.concat(chunks).toString("utf-8");
    const [learnings2 = "", issuesFixed2 = "", pending2 = ""] = buffered.split(`
`);
    return {
      learnings: learnings2.trim(),
      issuesFixed: issuesFixed2.trim(),
      pending: pending2.trim()
    };
  }
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  const question = (prompt) => new Promise((resolve2) => {
    rl.question(prompt, (answer) => {
      resolve2(answer.trim());
    });
  });
  const learnings = await question(`1. What did you learn today? (optional)
   > `);
  const issuesFixed = await question(`
2. What issues did you fix? (optional)
   > `);
  const pending = await question(`
3. What's pending for tomorrow? (optional)
   > `);
  rl.close();
  return {
    learnings,
    issuesFixed,
    pending
  };
}
function generateMarkdown(summary) {
  const lines = [];
  lines.push(`# Daily Summary \u2014 ${summary.date}`);
  lines.push("");
  lines.push(`**Generated:** ${summary.generatedAt}`);
  lines.push("");
  lines.push("## Meta");
  lines.push("");
  lines.push(`- **Date:** ${summary.date}`);
  lines.push(`- **Platforms:** ${summary.platforms.join(", ") || "unknown"}`);
  lines.push("");
  if (summary.tokenUsage) {
    const tu = summary.tokenUsage;
    lines.push("## Token Usage");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Input Tokens | ${tu.inputTokens.toLocaleString()} |`);
    lines.push(`| Output Tokens | ${tu.outputTokens.toLocaleString()} |`);
    lines.push(`| Cache Tokens | ${tu.cacheTokens.toLocaleString()} |`);
    lines.push(`| Total Tokens | ${tu.totalTokens.toLocaleString()} |`);
    lines.push(`| Estimated Cost | $${tu.costUsd.toFixed(4)} |`);
    lines.push("");
    if (tu.inputTokens > 0) {
      const cacheHitRate = tu.cacheTokens / (tu.inputTokens + tu.cacheTokens) * 100;
      lines.push(`**Cache Hit Rate:** ${cacheHitRate.toFixed(1)}%`);
      lines.push("");
    }
  }
  if (summary.gitActivity) {
    const ga = summary.gitActivity;
    lines.push("## Git Activity");
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Commits | ${ga.commitCount} |`);
    lines.push(`| Files Changed | ${ga.filesChanged} |`);
    lines.push(`| Insertions | +${ga.insertions} |`);
    lines.push(`| Deletions | -${ga.deletions} |`);
    lines.push("");
  }
  if (summary.commits.length > 0) {
    lines.push("## Commits");
    lines.push("");
    for (const commit of summary.commits.slice(0, 10)) {
      const shortHash = commit.hash.slice(0, 7);
      lines.push(`- \`${shortHash}\` ${commit.message}`);
    }
    if (summary.commits.length > 10) {
      lines.push(`- ... and ${summary.commits.length - 10} more commits`);
    }
    lines.push("");
  }
  const { learnings, issuesFixed, pending } = summary.annotations;
  if (learnings) {
    lines.push("## Learnings");
    lines.push("");
    lines.push(learnings);
    lines.push("");
  }
  if (issuesFixed) {
    lines.push("## Issues Fixed");
    lines.push("");
    lines.push(issuesFixed);
    lines.push("");
  }
  if (pending) {
    lines.push("## Pending");
    lines.push("");
    lines.push(pending);
    lines.push("");
  }
  if (summary.historyReportPath) {
    lines.push("## History Report");
    lines.push("");
    lines.push(`- **Newest artifact:** ${summary.historyReportPath}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  lines.push(`*Generated by sp:daily-summary at ${summary.generatedAt}*`);
  return lines.join(`
`);
}
function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}
function writeSummary(markdown, options) {
  const filename = `summary_${options.date.replace(/-/g, "")}.md`;
  const outputPath = options.outputPath || join(DAILY_DIR, filename);
  ensureDir(join(outputPath, ".."));
  writeFileSync(outputPath, markdown, "utf-8");
  return outputPath;
}
function resolveHistoryReportPath() {
  const pointer = resolve(process.cwd(), ".spur", "reports", "history", "latest.json");
  if (!existsSync(pointer)) {
    return;
  }
  try {
    const target = readlinkSync(pointer);
    const resolved = isAbsolute(target) ? target : resolve(dirname(pointer), target);
    return existsSync(resolved) ? resolved : undefined;
  } catch {
    return;
  }
}
async function buildDailySummary(options) {
  const platforms = [];
  let tokenUsage;
  if (!options.skipCcusage) {
    const ccusageData = await getCcusageData(options.date);
    if (ccusageData?.totals) {
      const totals = ccusageData.totals;
      tokenUsage = {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cacheTokens: totals.cacheCreationTokens + totals.cacheReadTokens,
        totalTokens: totals.totalTokens,
        costUsd: totals.totalCost
      };
      platforms.push("Claude Code");
    }
  }
  let gitActivity;
  let commits = [];
  if (!options.skipGit) {
    commits = await getGitCommits(options.date);
    if (commits.length > 0) {
      gitActivity = commits.reduce((acc, commit) => ({
        commitCount: acc.commitCount + 1,
        filesChanged: acc.filesChanged + (commit.filesChanged || 0),
        insertions: acc.insertions + (commit.insertions || 0),
        deletions: acc.deletions + (commit.deletions || 0)
      }), { commitCount: 0, filesChanged: 0, insertions: 0, deletions: 0 });
      platforms.push("Git");
    }
  }
  const historyReportPath = resolveHistoryReportPath();
  const annotations = await promptUser();
  const result = {
    date: options.date,
    platforms,
    commits,
    annotations,
    historyReportPath,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19)
  };
  if (tokenUsage !== undefined) {
    result.tokenUsage = tokenUsage;
  }
  if (gitActivity !== undefined) {
    result.gitActivity = gitActivity;
  }
  return result;
}
async function main() {
  const options = parseArgs();
  logger.info(`Generating daily summary for ${options.date}...`);
  try {
    const summary = await buildDailySummary(options);
    const markdown = generateMarkdown(summary);
    if (options.dryRun) {
      console.log(`
${markdown}
`);
      logger.info("(dry-run) Summary not written to file");
    } else {
      const outputPath = writeSummary(markdown, options);
      console.log(`
${markdown}
`);
      console.log(`
\u2705 Summary written to: ${outputPath}`);
    }
    console.log(`
\uD83D\uDCCA Summary Statistics:`);
    console.log(`   Date: ${summary.date}`);
    console.log(`   Platforms: ${summary.platforms.join(", ") || "none"}`);
    if (summary.tokenUsage) {
      console.log(`   Tokens: ${summary.tokenUsage.totalTokens.toLocaleString()}`);
      console.log(`   Cost: $${summary.tokenUsage.costUsd.toFixed(4)}`);
    }
    if (summary.gitActivity) {
      console.log(`   Commits: ${summary.gitActivity.commitCount}`);
    }
  } catch (error) {
    logger.error(`Failed to generate summary: ${error}`);
    process.exit(1);
  }
}
{
  main().catch((error) => {
    logger.error(`Daily summary failed: ${error}`);
    process.exit(1);
  });
}
export {
  yesterdayLocal,
  writeSummary,
  todayLocal,
  setProcessSpawner,
  promptUser,
  printUsage,
  parseArgs,
  main,
  getGitCommits,
  getDateRange,
  getCcusageData,
  generateMarkdown,
  ensureDir,
  defaultProcessSpawner,
  buildDailySummary
};
