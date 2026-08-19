#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts
var PIPELINE_TOKENS = [
  "--next",
  "dev-runall",
  "dev-wrapall",
  "dev-run",
  "dev-wrap",
  "dev-idea",
  "runall",
  "wrapall",
  "run",
  "wrap",
  "idea"
];
var PIPELINE_DRIVING_REFUSE_MESSAGE = "⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)";
var MUTATING_FIX_REFUSE_MESSAGE = "⚠ mutating --fix mode detected (--fix all | --fix blockers-first); pass --max-retry 0 (observe-only for the driver; the testee still mutates the tree) or --max-retry N (fix mode, driver + testee both mutate)";
var IMPLEMENT_HEAVY_ADVISORY_MESSAGE = "⚠ implement-heavy pipeline dogfood: prefer --max-retry 0 (observe-only) or step-split; operator --max-retry N overrides";
var IMPLEMENT_HEAVY_TOKENS = [
  "dev-runall",
  "dev-wrapall",
  "dev-run",
  "dev-wrap",
  "dev-idea",
  "runall",
  "wrapall",
  "run",
  "wrap",
  "idea",
  "implement"
];
function hasMutatingFixMode(step) {
  return /(?<![\w-])--fix[=\s]+(all|blockers-first)(?![\w-])/i.test(step);
}
function tokenMatches(testee, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "i");
  return re.test(testee);
}
function detectPipelineDriving(testee) {
  if (typeof testee !== "string" || testee.length === 0) {
    return false;
  }
  return PIPELINE_TOKENS.some((token) => tokenMatches(testee, token));
}
function isImplementHeavyStep(step) {
  if (typeof step !== "string" || step.length === 0)
    return false;
  const nonMutatingOnly = tokenMatches(step, "dev-verify") || tokenMatches(step, "dev-review") || tokenMatches(step, "dev-unit");
  const hasMutating = IMPLEMENT_HEAVY_TOKENS.some((token) => tokenMatches(step, token)) || hasMutatingFixMode(step);
  if (nonMutatingOnly && !hasMutating)
    return false;
  if (tokenMatches(step, "dev-refine") && !hasMutating && !tokenMatches(step, "--next")) {
    return false;
  }
  if (tokenMatches(step, "dev-refine") && tokenMatches(step, "--next")) {
    return true;
  }
  return hasMutating;
}
function detectImplementHeavy(testee, derivedSteps = []) {
  if (isImplementHeavyStep(testee))
    return true;
  if (!detectPipelineDriving(testee))
    return false;
  return derivedSteps.some((step) => isImplementHeavyStep(step));
}
function evaluateDogfoodGate(testee, options = {}) {
  const maxRetryPresent = options.maxRetryPresent === true;
  const steps = options.steps ?? [];
  const pipelineDriving = detectPipelineDriving(testee);
  const mutatingFix = hasMutatingFixMode(testee);
  const implementHeavy = detectImplementHeavy(testee, steps);
  if (pipelineDriving && !maxRetryPresent) {
    return {
      pipelineDriving,
      mutatingFix,
      maxRetryPresent,
      implementHeavy,
      refuse: true,
      advisory: false,
      message: PIPELINE_DRIVING_REFUSE_MESSAGE,
      exitCode: 2
    };
  }
  if (mutatingFix && !maxRetryPresent) {
    return {
      pipelineDriving,
      mutatingFix,
      maxRetryPresent,
      implementHeavy,
      refuse: true,
      advisory: false,
      message: MUTATING_FIX_REFUSE_MESSAGE,
      exitCode: 2
    };
  }
  if (implementHeavy) {
    return {
      pipelineDriving,
      mutatingFix,
      maxRetryPresent,
      implementHeavy,
      refuse: false,
      advisory: true,
      message: IMPLEMENT_HEAVY_ADVISORY_MESSAGE,
      exitCode: 0
    };
  }
  return {
    pipelineDriving,
    mutatingFix,
    maxRetryPresent,
    implementHeavy,
    refuse: false,
    advisory: false,
    message: null,
    exitCode: 0
  };
}
function parseCliArgs(argv) {
  let testee = null;
  let maxRetryPresent = false;
  let steps = [];
  let json = false;
  let help = false;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      help = true;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--max-retry-present") {
      maxRetryPresent = true;
    } else if (a === "--testee") {
      testee = argv[++i] ?? null;
    } else if (a === "--steps") {
      const raw = argv[++i] ?? "";
      steps = raw.length === 0 ? [] : raw.split("||").map((s) => s.trim()).filter(Boolean);
    } else if (a === "--") {
      testee = argv.slice(i + 1).join(" ");
      break;
    } else if (!a.startsWith("-") && testee === null) {
      testee = a;
    }
  }
  return { testee, maxRetryPresent, steps, json, help };
}
var CLI_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts \\
    --testee "<testee string>" [--max-retry-present] [--steps "s1||s2"] [--json]

Exit codes:
  0  proceed (stdout may carry implement-heavy advisory)
  2  refuse — pipeline-driving OR mutating --fix mode without --max-retry
  1  usage error

Phase 1.0: run BEFORE deriving steps (omit --steps).
Phase 1 W8: re-run AFTER step derivation with --steps "label1||label2".`;
function runCli(argv) {
  const { testee, maxRetryPresent, steps, json, help } = parseCliArgs(argv);
  if (help) {
    return { exitCode: 0, stdout: "", stderr: CLI_USAGE };
  }
  if (testee === null || testee.length === 0) {
    return { exitCode: 1, stdout: "", stderr: CLI_USAGE };
  }
  const result = evaluateDogfoodGate(testee, { maxRetryPresent, steps });
  if (json) {
    return { exitCode: result.exitCode, stdout: `${JSON.stringify(result, null, 2)}
`, stderr: "" };
  }
  if (result.message) {
    return { exitCode: result.exitCode, stdout: `${result.message}
`, stderr: "" };
  }
  return { exitCode: result.exitCode, stdout: "", stderr: "" };
}
{
  const { exitCode, stdout, stderr } = runCli(process.argv.slice(2));
  if (stdout)
    process.stdout.write(stdout);
  if (stderr)
    process.stderr.write(`${stderr}
`);
  process.exit(exitCode);
}
export {
  runCli,
  parseCliArgs,
  isImplementHeavyStep,
  hasMutatingFixMode,
  evaluateDogfoodGate,
  detectPipelineDriving,
  detectImplementHeavy,
  PIPELINE_TOKENS,
  PIPELINE_DRIVING_REFUSE_MESSAGE,
  MUTATING_FIX_REFUSE_MESSAGE,
  IMPLEMENT_HEAVY_ADVISORY_MESSAGE,
  CLI_USAGE
};
