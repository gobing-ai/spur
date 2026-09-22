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
`).filter((line) => line.trim().startsWith("|")).filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line.trim())).filter((line) => !/^\|\s*`?drift:/.test(line.trim()));
  return Math.max(rows.length - 1, 0);
}
function declaredExecutedSteps(markdown) {
  const match = markdown.match(/\*\*Steps:\*\*\s*\d+\s+derived,\s*(\d+)\s+executed/);
  return match ? Number.parseInt(match[1], 10) : null;
}
var UNKNOWN_CELLS = new Set(["~unknown", "unknown", "—", "-", "?", "n/a", "~n/a"]);
var CACHE_SHARE_TOLERANCE = 1;
function sectionBody(markdown, headingRe) {
  const heading = markdown.match(headingRe);
  if (!heading || heading.index === undefined)
    return null;
  const after = markdown.slice(heading.index + heading[0].length);
  const nextHeading = after.search(/^###? /m);
  return nextHeading === -1 ? after : after.slice(0, nextHeading);
}
function parseTokensLine(line) {
  const match = line.match(/~(?<total>n\/a|\d+)\s+total\s*\|\s*~(?<cached>n\/a|\d+)\s+cached(?:\s*\(\s*~?(?<pct>n\/a|\d+(?:\.\d+)?)%\s*hit rate\))?/i);
  if (!match)
    return null;
  const num = (v) => v === undefined ? null : v === "n/a" ? "n/a" : Number.parseInt(v, 10);
  return { total: num(match.groups?.total), cached: num(match.groups?.cached), pct: num(match.groups?.pct) };
}
function parseTokenCell(cell) {
  const t = cell.trim();
  if (UNKNOWN_CELLS.has(t))
    return null;
  const m = t.match(/~?(\d+)/);
  return m ? Number.parseInt(m[1], 10) : null;
}
function parsePctCell(cell) {
  const t = cell.trim();
  if (UNKNOWN_CELLS.has(t))
    return null;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number.parseFloat(m[1]) : null;
}
function ledgerCostRows(markdown) {
  const body = sectionBody(markdown, /^### 3\. Monitor Ledger\s*$/m);
  if (body === null)
    return [];
  return body.split(`
`).filter((line) => line.trim().startsWith("|")).filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line.trim())).filter((line) => !/^\|\s*`?drift:/.test(line.trim())).slice(1).map((line) => {
    const cells = line.split("|").map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === "") && !(i === a.length - 1 && c === ""));
    const freshCell = cells[5] ?? "";
    const cachedCell = cells[6] ?? "";
    return {
      fresh: parseTokenCell(freshCell),
      cached: parseTokenCell(cachedCell),
      cachePct: parsePctCell(cells[7] ?? ""),
      unknownCell: UNKNOWN_CELLS.has(freshCell) || UNKNOWN_CELLS.has(cachedCell)
    };
  });
}
function validateCostEvidence(markdown, errors) {
  const costBlock = sectionBody(markdown, /^#### Cost\s*$/m);
  if (costBlock === null) {
    errors.push("missing_cost_block");
    return;
  }
  for (const field of ["Ledger estimate", "Method", "Meter"]) {
    if (!costBlock.includes(`**${field}:**`))
      errors.push(`missing_cost_field:${field}`);
  }
  const ledgerLine = costBlock.split(`
`).find((l) => l.includes("**Ledger estimate:**")) ?? "";
  const costTotals = parseTokensLine(ledgerLine);
  if (ledgerLine !== "" && costTotals === null)
    errors.push("malformed_cost_line");
  const footerLine = markdown.split(`
`).find((l) => l.trim().startsWith("Tokens:"));
  const footerTotals = footerLine ? parseTokensLine(footerLine) : null;
  if (footerLine !== undefined && footerTotals === null)
    errors.push("malformed_footer");
  const pctScopes = [costBlock, footerLine ?? ""];
  for (const row of ledgerCostRows(markdown)) {
    if (row.cachePct !== null)
      pctScopes.push(`${row.cachePct}%`);
  }
  for (const scope of pctScopes) {
    for (const m of scope.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
      const pct = Number.parseFloat(m[1]);
      if (pct < 0 || pct > 100)
        errors.push(`impossible_percentage:${m[0].trim()}`);
    }
  }
  const rows = ledgerCostRows(markdown);
  for (const row of rows) {
    if (row.unknownCell && row.cachePct !== null)
      errors.push("unknown_row_with_numeric_cache");
  }
  const observable = rows.filter((r) => r.fresh !== null && r.cached !== null);
  const sumFresh = observable.reduce((acc, r) => acc + (r.fresh ?? 0), 0);
  const sumCached = observable.reduce((acc, r) => acc + (r.cached ?? 0), 0);
  const checkTotals = (label, totals) => {
    if (totals === null)
      return;
    if (observable.length > 0) {
      const expectedTotal = sumFresh + sumCached;
      if (typeof totals.total === "number" && totals.total !== expectedTotal) {
        errors.push(`cost_total_mismatch:${label}_expected_${expectedTotal}`);
      }
      if (typeof totals.cached === "number" && totals.cached !== sumCached) {
        errors.push(`cost_total_mismatch:${label}_cached_expected_${sumCached}`);
      }
      const expectedPct = expectedTotal > 0 ? Math.round(sumCached / expectedTotal * 100) : null;
      if (expectedPct !== null) {
        if (totals.pct === "n/a" || totals.pct === null) {
          errors.push(`missing_cache_share:${label}`);
        } else if (typeof totals.pct === "number" && Math.abs(totals.pct - expectedPct) > CACHE_SHARE_TOLERANCE) {
          errors.push(`cache_share_mismatch:${label}_expected_${expectedPct}`);
        }
      }
    } else if (typeof totals.total === "number" || typeof totals.cached === "number" || typeof totals.pct === "number") {
      errors.push(`fabricated_cache_share:${label}`);
    }
  };
  checkTotals("cost", costTotals);
  checkTotals("footer", footerTotals);
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
  validateCostEvidence(markdown, errors);
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

Cost evidence (task 0913): a complete report must carry the Cost block
(Ledger estimate / Method / Meter), percentages within 0..100, totals equal to
the ledger sums of observable rows (fresh + cached), and 'n/a' (never a
fabricated number) when no observable rows exist. Display-rounding tolerance
for the cache share is ±1 percentage point.

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
