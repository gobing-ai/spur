#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// plugins/sp/scripts/dogfood-testing/validate-report.ts
import { readFileSync } from "node:fs";
var REQUIRED_SECTIONS = [1, 2, 3, 4, 5, 6];
var CANONICAL_PROTOCOL = "sp:dogfood-testing@1.2";
function countSectionHeadings(markdown, section) {
  const re = new RegExp(`^### ${section}\\.`, "gm");
  return (markdown.match(re) ?? []).length;
}
function countLedgerDataRows(markdown) {
  const heading = markdown.match(/^### 3\. Monitor Ledger\s*$/m);
  if (!heading || heading.index === undefined)
    return null;
  const after = markdown.slice(heading.index + heading[0].length);
  const nextHeading = after.search(/^### /m);
  const body = nextHeading === -1 ? after : after.slice(0, nextHeading);
  const rows = body.split(`
`).filter((line) => line.trim().startsWith("|")).filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line.trim())).filter((line) => !/^\|\s*drift:/.test(line.trim()));
  return Math.max(rows.length - 1, 0);
}
function declaredExecutedSteps(markdown) {
  const match = markdown.match(/\*\*Steps:\*\*\s*\d+\s+derived,\s*(\d+)\s+executed/);
  return match ? Number.parseInt(match[1], 10) : null;
}
function validateReport(markdown) {
  const errors = [];
  if (!markdown.includes("── Dogfood Summary ──"))
    errors.push("missing_footer");
  if (!markdown.includes("[Live:"))
    errors.push("missing_live_path");
  if (!markdown.includes("[Report:"))
    errors.push("missing_report_path");
  for (const section of REQUIRED_SECTIONS) {
    const count = countSectionHeadings(markdown, section);
    if (count === 0)
      errors.push(`missing_section:${section}`);
    if (count > 1)
      errors.push(`duplicate_section:${section}`);
  }
  if (!markdown.includes("#### Fixed") || !markdown.includes("#### Unresolved")) {
    errors.push("missing_issues_subheads");
  }
  const protocolMatch = markdown.match(/^protocol:\s*(\S+)\s*$/m);
  if (!protocolMatch || protocolMatch[1] !== CANONICAL_PROTOCOL) {
    errors.push("protocol_string");
  }
  const executed = declaredExecutedSteps(markdown);
  if (executed === null) {
    errors.push("missing_steps_declared");
  } else {
    const rows = countLedgerDataRows(markdown);
    if (rows === null || rows !== executed) {
      errors.push("ledger_cardinality");
    }
  }
  return { ok: errors.length === 0, errors };
}
function parseValidateCliArgs(argv) {
  let file = null;
  let json = false;
  let help = false;
  for (let i = 0;i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h")
      help = true;
    else if (a === "--json")
      json = true;
    else if (a === "--file")
      file = argv[++i] ?? null;
    else if (!a.startsWith("-") && file === null)
      file = a;
  }
  return { file, json, help };
}
var VALIDATE_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file <report.md> [--json]

Exit codes:
  0  report validates clean (complete-report shape)
  2  validation failed (errors on stdout / --json)
  1  usage error

Phase 4 finalize MUST run this before status: complete (task 0278 R6).
On exit 2: set status: aborted and list error codes under #### Unresolved.`;
function runValidateCli(argv, readFile) {
  const { file, json, help } = parseValidateCliArgs(argv);
  if (help)
    return { exitCode: 0, stdout: "", stderr: VALIDATE_CLI_USAGE };
  if (file === null || file.length === 0) {
    return { exitCode: 1, stdout: "", stderr: VALIDATE_CLI_USAGE };
  }
  let markdown;
  try {
    markdown = readFile(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { exitCode: 1, stdout: "", stderr: `Failed to read ${file}: ${msg}` };
  }
  const result = validateReport(markdown);
  if (json) {
    return {
      exitCode: result.ok ? 0 : 2,
      stdout: `${JSON.stringify(result, null, 2)}
`,
      stderr: ""
    };
  }
  if (result.ok) {
    return { exitCode: 0, stdout: `ok
`, stderr: "" };
  }
  return {
    exitCode: 2,
    stdout: `${result.errors.join(`
`)}
`,
    stderr: ""
  };
}
function mainCli(argv = process.argv.slice(2)) {
  const { exitCode, stdout, stderr } = runValidateCli(argv, (p) => readFileSync(p, "utf8"));
  if (stdout)
    process.stdout.write(stdout);
  if (stderr)
    process.stderr.write(`${stderr}
`);
  return exitCode;
}
{
  process.exit(mainCli());
}
export {
  validateReport,
  runValidateCli,
  parseValidateCliArgs,
  mainCli,
  VALIDATE_CLI_USAGE
};
