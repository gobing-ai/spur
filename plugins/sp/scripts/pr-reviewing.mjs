#!/usr/bin/env node
// @bun

// plugins/sp/scripts/pr-reviewing.ts
import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
var spawnRunner = (cmd) => {
  const proc = spawnSync(cmd[0] ?? "", [...cmd.slice(1)], { encoding: "utf8", env: process.env });
  return {
    code: proc.status ?? 1,
    stdout: proc.stdout ?? "",
    stderr: proc.stderr ?? "",
    error: proc.error?.message
  };
};
var runner = spawnRunner;
function setCommandRunner(next) {
  runner = next ?? spawnRunner;
}
function run(cmd) {
  return runner(cmd);
}
function runOk(cmd, what) {
  const res = run(cmd);
  if (res.code !== 0) {
    throw new Error(`${what} failed: ${res.stderr.trim() || res.stdout.trim() || res.error || `exit ${res.code}`}`);
  }
  return res.stdout.trim();
}
function parseJson(raw, what) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${what}: unparseable JSON output`);
  }
}
var VALUE_FLAGS = new Set(["--base", "--focus", "--since", "--head", "--timeout", "--interval", "--status-file"]);
var BOOL_FLAGS = new Set(["--json", "--force"]);
function parseArgs(argv) {
  const [subcommand = "", ...rest] = argv;
  const flags = new Map;
  const booleans = new Set;
  for (let i = 0;i < rest.length; i++) {
    const tok = rest[i];
    if (BOOL_FLAGS.has(tok)) {
      booleans.add(tok);
    } else if (VALUE_FLAGS.has(tok)) {
      const value = rest[i + 1];
      if (value === undefined)
        throw new Error(`flag ${tok} requires a value`);
      flags.set(tok, value);
      i++;
    } else {
      throw new Error(`unknown argument: ${tok}`);
    }
  }
  return { subcommand, flags, booleans };
}
function emit(args, payload, human) {
  if (args.booleans.has("--json")) {
    console.log(JSON.stringify(payload));
  } else {
    console.log(human);
  }
}

class ScriptExit extends Error {
  code;
  json;
  constructor(message, code, json) {
    super(message);
    this.code = code;
    this.json = json;
  }
}
function fail(args, message, code) {
  throw new ScriptExit(message, code, args?.booleans.has("--json") ?? false);
}
function writeStatus(args, verdict) {
  const file = args.flags.get("--status-file");
  if (file)
    writeFileSync(file, `${verdict}
`);
}
function writeFailureStatus(args) {
  const file = args?.flags.get("--status-file");
  if (!file)
    return;
  try {
    writeFileSync(file, `FAIL
`);
  } catch {}
}
function isCodexAuthor(login, type) {
  return /codex/i.test(login ?? "") && (type === "Bot" || /\[bot\]$/i.test(login ?? ""));
}
function isHeadReviewed(reviews, head) {
  return reviews.some((review) => isCodexAuthor(review.user?.login, review.user?.type) && review.commit_id === head && isCompletedReview(review));
}
function isCompletedReview(review) {
  const state = (review.state ?? "").toUpperCase();
  return review.submitted_at !== undefined && state !== "DISMISSED" && state !== "PENDING";
}
var CLEAN_REVIEW_RE = /\b(?:no|zero)\s+(?:actionable\s+)?(?:findings?|issues?|problems?)\b|\b(?:looks|seems)\s+good\b|\blgtm\b|\bno\s+concerns\b/i;
function isExplicitCleanReview(review, head) {
  if (!isCodexAuthor(review.user?.login, review.user?.type) || review.commit_id !== head || !isCompletedReview(review)) {
    return false;
  }
  const body = (review.body ?? "").trim();
  if (/\bP[0-3]\b/i.test(body))
    return false;
  const state = (review.state ?? "").toUpperCase();
  if (!["APPROVED", "CLEAN", "COMMENTED"].includes(state))
    return false;
  return state === "CLEAN" || state === "APPROVED" && body === "" || CLEAN_REVIEW_RE.test(body);
}
function isFresh(at, since) {
  if (at === undefined)
    return false;
  if (since === "")
    return true;
  const atMs = Date.parse(at);
  const sinceMs = Date.parse(since);
  return Number.isFinite(atMs) && Number.isFinite(sinceMs) && atMs >= Math.floor(sinceMs / 1000) * 1000;
}
function hasCurrentCleanReview(reviews, since, head) {
  return reviews.some((review) => isFresh(review.submitted_at, since) && isExplicitCleanReview(review, head));
}
function extractSeverity(body) {
  const match = body.match(/\bP([0-3])\b/);
  return match ? `P${match[1]}` : "unrated";
}
var DEFAULT_FOCUS = "for correctness and regressions, security boundaries, data-loss risks, concurrency or race conditions, " + "API/backward compatibility, migration safety, error handling, and missing high-value tests. " + "Prioritize actionable issues over style or nits.";
function hasCodeReviewRules(repoRoot) {
  const agentsPath = join(repoRoot, "AGENTS.md");
  if (!existsSync(agentsPath))
    return false;
  return /^## Code Review Rules\s*$/m.test(readFileSync(agentsPath, "utf8"));
}
function buildRequestBody(rulesPresent, focus) {
  const base = rulesPresent ? "@codex review" : `@codex review ${DEFAULT_FOCUS}`;
  const trimmed = focus.trim();
  return trimmed === "" ? base : `${base} Focus especially on ${trimmed}.`;
}
var BLOCK_LINE_PATTERNS = [
  [/^(<{7}|={7}|>{7})(\s|$)/, "merge-conflict marker"],
  [/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, "private key material"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub fine-grained PAT"],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, "API secret key"],
  [/\bxox[bapors]-[A-Za-z0-9-]{10,}\b/, "Slack token"]
];
var WARN_LINE_PATTERNS = [
  [/\bdebugger\b/, "debugger statement"],
  [/\bconsole\.(log|debug|trace)\(/, "debug logging"]
];
function scanHygiene(diffText, changedFiles) {
  const blockers = [];
  const warnings = [];
  for (const file of changedFiles) {
    if (/(^|\/)\.env(\.[^/]+)?$/.test(file) && !/\.(example|sample|template)$/.test(file)) {
      blockers.push(`${file}: committed .env file`);
    }
  }
  for (const line of diffText.split(`
`)) {
    if (!line.startsWith("+") || line.startsWith("+++"))
      continue;
    const added = line.slice(1);
    let blocked = false;
    for (const [pattern, label] of BLOCK_LINE_PATTERNS) {
      if (pattern.test(added)) {
        blockers.push(`${label}: redacted`);
        blocked = true;
        break;
      }
    }
    if (blocked)
      continue;
    for (const [pattern, label] of WARN_LINE_PATTERNS) {
      if (pattern.test(added)) {
        warnings.push(`${label}: ${added.trim().slice(0, 80)}`);
        break;
      }
    }
  }
  const verdict = blockers.length > 0 ? "BLOCK" : warnings.length > 0 ? "WARN" : "PASS";
  return { verdict, blockers, warnings };
}
function normalizeFindings(reviews, inline, comments, since, head) {
  const findings = [];
  const fresh = (at) => isFresh(at, since);
  const onHead = (commitId) => commitId === head;
  for (const r of reviews) {
    if (!isCodexAuthor(r.user?.login, r.user?.type) || !isCompletedReview(r) || !fresh(r.submitted_at) || !onHead(r.commit_id))
      continue;
    if (isExplicitCleanReview(r, head))
      continue;
    if ((r.body ?? "").trim() === "")
      continue;
    findings.push({
      kind: "review",
      severity: extractSeverity(r.body ?? ""),
      path: null,
      line: null,
      body: r.body ?? "",
      url: r.html_url ?? "",
      at: r.submitted_at ?? ""
    });
  }
  for (const c of inline) {
    if (!isCodexAuthor(c.user?.login, c.user?.type) || !fresh(c.created_at) || !onHead(c.commit_id))
      continue;
    findings.push({
      kind: "inline",
      severity: extractSeverity(c.body ?? ""),
      path: c.path ?? null,
      line: c.line ?? null,
      body: c.body ?? "",
      url: c.html_url ?? "",
      at: c.created_at ?? ""
    });
  }
  for (const c of comments) {
    if (!isCodexAuthor(c.user?.login, c.user?.type) || !fresh(c.created_at) || !onHead(c.commit_id))
      continue;
    findings.push({
      kind: "comment",
      severity: extractSeverity(c.body ?? ""),
      path: null,
      line: null,
      body: c.body ?? "",
      url: c.html_url ?? "",
      at: c.created_at ?? ""
    });
  }
  return findings.sort((a, b) => a.at.localeCompare(b.at));
}
function renderFindings(findings) {
  if (findings.length === 0)
    return "Codex review completed without actionable findings.";
  const lines = [`Findings (${findings.length})`, ""];
  findings.forEach((f, i) => {
    const where = f.path ? `${f.path}${f.line ? `:${f.line}` : ""}` : f.kind;
    lines.push(`${i + 1}. [${f.severity}] ${where}`);
    lines.push(`   ${f.body.split(`
`)[0]}`);
    if (f.url)
      lines.push(`   ${f.url}`);
  });
  return lines.join(`
`);
}
function preflightContext() {
  const repoRoot = runOk(["git", "rev-parse", "--show-toplevel"], "git rev-parse --show-toplevel");
  const branch = runOk(["git", "branch", "--show-current"], "git branch --show-current");
  if (branch === "")
    throw new Error("HEAD is detached \u2014 check out a branch before requesting a PR review");
  const head = runOk(["git", "rev-parse", "HEAD"], "git rev-parse HEAD");
  const auth = run(["gh", "auth", "status"]);
  if (auth.code !== 0) {
    throw new Error("gh CLI missing or unauthenticated \u2014 install gh and run `gh auth login` (no browser fallback)");
  }
  const repo = parseJson(runOk(["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "gh repo view"), "gh repo view");
  return {
    repoRoot,
    nameWithOwner: repo.nameWithOwner,
    branch,
    head,
    shortHead: head.slice(0, 7),
    defaultBranch: repo.defaultBranchRef.name
  };
}
function resolveUpstream() {
  const refRes = run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (refRes.code !== 0)
    return null;
  const ref = refRes.stdout.trim();
  const count = (res) => {
    const n = Number(res.stdout.trim());
    return res.code === 0 && Number.isFinite(n) ? n : 0;
  };
  return {
    ref,
    ahead: count(run(["git", "rev-list", "--count", "@{u}..HEAD"])),
    behind: count(run(["git", "rev-list", "--count", "HEAD..@{u}"]))
  };
}
function viewPr() {
  const res = run([
    "gh",
    "pr",
    "view",
    "--json",
    "number,url,state,isDraft,headRefName,baseRefName,title,headRefOid"
  ]);
  if (res.code !== 0) {
    const detail = `${res.stderr}
${res.stdout}`;
    if (/no pull requests? found|no pull request associated|could not find pull request/i.test(detail))
      return null;
    throw new Error(`gh pr view failed: ${res.stderr.trim() || res.stdout.trim() || res.error || `exit ${res.code}`}`);
  }
  return parseJson(res.stdout, "gh pr view");
}
function fetchReviews(ctx, pr) {
  return fetchPaginated(`repos/${ctx.nameWithOwner}/pulls/${pr}/reviews`, "gh api reviews");
}
function fetchInlineComments(ctx, pr) {
  return fetchPaginated(`repos/${ctx.nameWithOwner}/pulls/${pr}/comments`, "gh api review comments");
}
function fetchIssueComments(ctx, pr) {
  return fetchPaginated(`repos/${ctx.nameWithOwner}/issues/${pr}/comments`, "gh api issue comments");
}
function fetchPaginated(endpoint, what) {
  const pages = parseJson(runOk(["gh", "api", "--method", "GET", endpoint, "--paginate", "--slurp"], what), what);
  return pages.flat();
}
var requestMarker = (head) => `<!-- spur-pr-review head:${head} -->`;
function hasPendingRequest(comments, head, login) {
  const marker = requestMarker(head);
  return comments.some((comment) => comment.user?.login === login && (comment.body ?? "").includes(marker));
}
function requireExpectedHead(args, pr) {
  const expected = args.flags.get("--head");
  if (expected && expected !== pr.headRefOid) {
    writeStatus(args, "FAIL");
    fail(args, `PR HEAD moved from ${expected.slice(0, 7)} to ${pr.headRefOid.slice(0, 7)} \u2014 request a new review`, 2);
  }
}
function cmdPreflight(args) {
  const ctx = preflightContext();
  const dirty = run(["git", "status", "--porcelain"]);
  if (dirty.code !== 0)
    fail(args, `git status failed: ${dirty.stderr.trim() || dirty.error || `exit ${dirty.code}`}`, 2);
  const dirtyFiles = dirty.stdout.split(`
`).filter((l) => l.trim() !== "");
  if (dirtyFiles.length > 0) {
    writeStatus(args, "FAIL");
    fail(args, `working tree is dirty (${dirtyFiles.length} entries) \u2014 a PR only reviews pushed commits; ` + "commit or stash first, or let the skill triage the changes interactively", 2);
  }
  const base = (args.flags.get("--base") ?? "").trim() || ctx.defaultBranch;
  const upstream = resolveUpstream();
  if (ctx.branch === base) {
    writeStatus(args, "FAIL");
    fail(args, `current branch is the base branch (${base}) \u2014 a PR reviews a feature branch against it; ` + "check out a feature branch (nothing on the base branch is reviewable)", 2);
  }
  writeStatus(args, "PASS");
  emit(args, { ok: true, ...ctx, upstream }, [
    `Repository: ${ctx.nameWithOwner}`,
    `Branch:     ${ctx.branch}`,
    `HEAD:       ${ctx.shortHead}`,
    `Default:    ${ctx.defaultBranch}`,
    `Upstream:   ${upstream ? `${upstream.ref} (ahead ${upstream.ahead}, behind ${upstream.behind})` : `none (publishing would create origin/${ctx.branch})`}`,
    "Local:      clean"
  ].join(`
`));
}
function cmdPush(args) {
  const ctx = preflightContext();
  const upstream = run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.code !== 0) {
    runOk(["git", "push", "-u", "origin", "HEAD"], "git push -u origin HEAD");
    writeStatus(args, "PUSHED");
    emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} and set upstream to origin/HEAD.`);
    return;
  }
  const remoteHead = runOk(["git", "rev-parse", "@{u}"], "git rev-parse @{u}");
  if (remoteHead === ctx.head) {
    writeStatus(args, "UP_TO_DATE");
    emit(args, { ok: true, pushed: false, head: ctx.head }, `Remote already at ${ctx.shortHead}.`);
    return;
  }
  runOk(["git", "push"], "git push (fast-forward only \u2014 never force)");
  writeStatus(args, "PUSHED");
  emit(args, { ok: true, pushed: true, head: ctx.head }, `Pushed ${ctx.branch} -> ${ctx.shortHead}.`);
}
function cmdEnsurePr(args) {
  const ctx = preflightContext();
  const existing = viewPr();
  if (existing) {
    writeStatus(args, "FOUND");
    emit(args, { ok: true, created: false, pr: existing }, `PR #${existing.number} ${existing.url}
Base: ${existing.baseRefName}  State: ${existing.state}`);
    return;
  }
  const base = (args.flags.get("--base") ?? "").trim() || ctx.defaultBranch;
  if (ctx.branch === base) {
    writeStatus(args, "FAIL");
    fail(args, `current branch is the base branch (${base}) \u2014 nothing to review`, 2);
  }
  const commits = run(["git", "log", "--oneline", `${base}..HEAD`]);
  if (commits.code !== 0)
    fail(args, `git log failed: ${commits.stderr.trim() || commits.error || `exit ${commits.code}`}`, 2);
  if (commits.stdout.trim() === "") {
    writeStatus(args, "FAIL");
    fail(args, `no commits on ${ctx.branch} beyond ${base} \u2014 nothing to review`, 2);
  }
  runOk(["gh", "pr", "create", "--fill", "--base", base], "gh pr create");
  const pr = viewPr();
  if (!pr) {
    writeStatus(args, "FAIL");
    fail(args, "gh pr create reported success but the PR is not visible", 2);
  }
  writeStatus(args, "CREATED");
  emit(args, { ok: true, created: true, pr }, `Created PR #${pr.number} ${pr.url}
Base: ${pr.baseRefName}`);
}
function cmdHygiene(args) {
  const ctx = preflightContext();
  const pr = viewPr();
  const base = (args.flags.get("--base") ?? "").trim() || pr?.baseRefName || ctx.defaultBranch;
  const filesRaw = run(["git", "diff", "--name-only", "--diff-filter=AMCR", `${base}...HEAD`]);
  if (filesRaw.code !== 0) {
    writeStatus(args, "FAIL");
    fail(args, `git diff --name-only failed (exit ${filesRaw.code})`, 2);
  }
  const changedFiles = filesRaw.stdout.split(`
`).filter((l) => l.trim() !== "");
  const diffRaw = run(["git", "diff", `${base}...HEAD`]);
  if (diffRaw.code !== 0) {
    writeStatus(args, "FAIL");
    fail(args, `git diff failed (exit ${diffRaw.code})`, 2);
  }
  const diff = diffRaw.stdout;
  const result = scanHygiene(diff, changedFiles);
  writeStatus(args, result.verdict);
  const human = [
    `Hygiene (${base}...HEAD): ${result.verdict}`,
    ...result.blockers.map((b) => `  BLOCK ${b}`),
    ...result.warnings.map((w) => `  WARN  ${w}`)
  ].join(`
`);
  emit(args, { ok: result.verdict !== "BLOCK", ...result }, human);
  if (result.verdict === "BLOCK")
    throw new ScriptExit("", 2, args.booleans.has("--json"));
}
function cmdRequest(args) {
  const ctx = preflightContext();
  const pr = viewPr();
  if (!pr) {
    writeStatus(args, "FAIL");
    fail(args, "no PR for the current branch \u2014 run ensure-pr first", 2);
  }
  const force = args.booleans.has("--force");
  const reviews = fetchReviews(ctx, pr.number);
  if (!force && isHeadReviewed(reviews, pr.headRefOid)) {
    writeStatus(args, "ALREADY_REVIEWED");
    emit(args, { ok: true, requested: false, alreadyReviewed: true, pr: pr.number, url: pr.url, head: pr.headRefOid }, `PR #${pr.number}: current HEAD ${pr.headRefOid.slice(0, 7)} already has a Codex review \u2014 not requesting a duplicate.`);
    return;
  }
  if (!force) {
    const login = runOk(["gh", "api", "user", "--jq", ".login"], "gh api user");
    if (hasPendingRequest(fetchIssueComments(ctx, pr.number), pr.headRefOid, login)) {
      writeStatus(args, "ALREADY_REQUESTED");
      emit(args, { ok: true, requested: false, pending: true, pr: pr.number, url: pr.url, head: pr.headRefOid }, `PR #${pr.number}: current HEAD ${pr.headRefOid.slice(0, 7)} already has a pending Codex request.`);
      return;
    }
  }
  const body = `${buildRequestBody(hasCodeReviewRules(ctx.repoRoot), args.flags.get("--focus") ?? "")}

${requestMarker(pr.headRefOid)}`;
  const requestedAt = new Date().toISOString();
  runOk(["gh", "pr", "comment", String(pr.number), "--body", body], "gh pr comment (@codex review)");
  writeStatus(args, "REQUESTED");
  emit(args, { ok: true, requested: true, pr: pr.number, url: pr.url, head: pr.headRefOid, requestedAt, body }, `Requested GitHub Codex review on PR #${pr.number} (${pr.url}) at HEAD ${pr.headRefOid.slice(0, 7)}.`);
}
function cmdWait(args) {
  const since = args.flags.get("--since") ?? new Date().toISOString();
  const timeoutSec = Number(args.flags.get("--timeout") ?? "600");
  const intervalSec = Number(args.flags.get("--interval") ?? "30");
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0)
    fail(args, "--timeout must be a non-negative number", 1);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0)
    fail(args, "--interval must be a positive number", 1);
  const ctx = preflightContext();
  const pr = viewPr();
  if (!pr) {
    writeStatus(args, "FAIL");
    fail(args, "no PR for the current branch", 2);
  }
  requireExpectedHead(args, pr);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;; ) {
    const reviews = fetchReviews(ctx, pr.number);
    const findings = normalizeFindings(reviews, fetchInlineComments(ctx, pr.number), fetchIssueComments(ctx, pr.number), since, pr.headRefOid);
    if (findings.length > 0) {
      writeStatus(args, "FOUND");
      emit(args, { ok: true, verdict: "FOUND", findings }, renderFindings(findings));
      return;
    }
    if (hasCurrentCleanReview(reviews, since, pr.headRefOid)) {
      writeStatus(args, "CLEAN");
      emit(args, { ok: true, verdict: "CLEAN", pr: pr.number, url: pr.url, head: pr.headRefOid, findings: [] }, `Codex review completed cleanly for HEAD ${pr.headRefOid.slice(0, 7)}.`);
      return;
    }
    if (Date.now() >= deadline) {
      writeStatus(args, "TIMEOUT");
      emit(args, { ok: true, verdict: "TIMEOUT", pr: pr.number, url: pr.url }, `No Codex review within ${timeoutSec}s \u2014 still pending. Collect later with /sp:dev-pr-review collect.
PR: ${pr.url}`);
      throw new ScriptExit("", 3, args.booleans.has("--json"));
    }
    const sleepMs = intervalSec * 1000;
    if (sleepMs > 0)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, sleepMs);
  }
}
function cmdCollect(args) {
  const ctx = preflightContext();
  const pr = viewPr();
  if (!pr) {
    fail(args, "no PR for the current branch", 2);
  }
  requireExpectedHead(args, pr);
  const since = args.flags.get("--since") ?? "";
  const reviews = fetchReviews(ctx, pr.number);
  const findings = normalizeFindings(reviews, fetchInlineComments(ctx, pr.number), fetchIssueComments(ctx, pr.number), since, pr.headRefOid);
  const verdict = findings.length > 0 ? "FINDINGS" : hasCurrentCleanReview(reviews, since, pr.headRefOid) ? "CLEAN" : "PENDING";
  writeStatus(args, verdict);
  const header = `PR #${pr.number} ${pr.url}
HEAD ${pr.headRefOid.slice(0, 7)} \u2014 Codex: ${verdict === "FINDINGS" ? "findings" : verdict.toLowerCase()}`;
  const summary = verdict === "PENDING" ? "No current-HEAD Codex review result yet \u2014 still pending." : renderFindings(findings);
  emit(args, { ok: true, verdict, pr: pr.number, url: pr.url, head: pr.headRefOid, findings }, `${header}

${summary}`);
}
function cmdStatus(args) {
  const ctx = preflightContext();
  const pr = viewPr();
  if (pr)
    requireExpectedHead(args, pr);
  const dirtyResult = run(["git", "status", "--porcelain"]);
  if (dirtyResult.code !== 0) {
    fail(args, `git status failed: ${dirtyResult.stderr.trim() || dirtyResult.error || `exit ${dirtyResult.code}`}`, 2);
  }
  const dirty = dirtyResult.stdout.trim();
  let ci = "unavailable";
  let codex = "not requested";
  const since = args.flags.get("--since") ?? "";
  if (pr) {
    const checks = run(["gh", "pr", "checks", String(pr.number), "--json", "bucket"]);
    if ([0, 1, 8].includes(checks.code) && checks.stdout.trim() !== "") {
      const buckets = parseJson(checks.stdout, "gh pr checks").map((check) => check.bucket ?? "");
      if (buckets.some((bucket) => bucket === "fail" || bucket === "cancel"))
        ci = "failing";
      else if (buckets.some((bucket) => bucket === "pending"))
        ci = "pending";
      else if (buckets.length > 0 && buckets.every((bucket) => bucket === "pass"))
        ci = "passing";
    }
    const reviews = fetchReviews(ctx, pr.number);
    const codexReviews = reviews.filter((r) => isCodexAuthor(r.user?.login, r.user?.type));
    if (codexReviews.length > 0) {
      const inline = fetchInlineComments(ctx, pr.number);
      const findings = normalizeFindings(reviews, inline, [], since, pr.headRefOid);
      if (findings.length > 0)
        codex = "findings";
      else if (hasCurrentCleanReview(reviews, since, pr.headRefOid))
        codex = "clean";
      else if (codexReviews.some((review) => review.commit_id === pr.headRefOid))
        codex = "pending";
      else
        codex = "stale \u2014 HEAD moved";
    }
  }
  const payload = {
    ok: true,
    repo: ctx.nameWithOwner,
    branch: ctx.branch,
    head: ctx.shortHead,
    base: pr?.baseRefName ?? ctx.defaultBranch,
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null,
    local: dirty === "" ? "clean" : "modified",
    ci,
    codex
  };
  emit(args, payload, [
    `Repository: ${payload.repo}`,
    `PR:         ${pr ? `#${pr.number} ${pr.url}` : "none"}`,
    `Branch:     ${payload.branch}`,
    `HEAD:       ${payload.head}`,
    `Base:       ${payload.base}`,
    `Local:      ${payload.local}`,
    `CI:         ${payload.ci}`,
    `Codex:      ${payload.codex}`
  ].join(`
`));
}
var HELP = `pr-reviewing.ts \u2014 deterministic spine for /sp:dev-pr-review (sp:pr-reviewing)

Installed usage: node "$(superskill script path sp pr-reviewing.mjs)" <subcommand> [flags]
Source-tree usage: bun plugins/sp/scripts/pr-reviewing.ts <subcommand> [flags]

Subcommands:
  preflight            git/gh/repo checks; FAILs on detached HEAD or a dirty tree
  push                 push the branch (never force); sets upstream when missing
  ensure-pr [--base b] reuse the branch's PR or create one with gh pr create --fill
  hygiene  [--base b]  scan base...HEAD for secrets/.env/conflict markers (BLOCK) and debug residue (WARN)
  request  [--force] [--focus text]
                       post @codex review (dedupes reviewed/in-flight HEAD unless --force)
  wait     [--since iso] [--head sha] [--timeout 600] [--interval 30]
                       poll for Codex output; exit 3 on timeout (pending, not failed)
  collect  [--since iso] [--head sha]
                       fetch the current-HEAD Codex result (FINDINGS, CLEAN, or PENDING)
  status   [--since iso] [--head sha] composite repo/PR/CI/Codex status (read-only)

Global flags: --json (single JSON object)  --status-file <path> (one-word verdict)
Exit codes: 0 ok \xB7 1 usage \xB7 2 hard failure \xB7 3 wait timeout`;
function main(argv) {
  let args = null;
  try {
    args = parseArgs(argv);
    switch (args.subcommand) {
      case "preflight":
        cmdPreflight(args);
        return 0;
      case "push":
        cmdPush(args);
        return 0;
      case "ensure-pr":
        cmdEnsurePr(args);
        return 0;
      case "hygiene":
        cmdHygiene(args);
        return 0;
      case "request":
        cmdRequest(args);
        return 0;
      case "wait":
        cmdWait(args);
        return 0;
      case "collect":
        cmdCollect(args);
        return 0;
      case "status":
        cmdStatus(args);
        return 0;
      case "":
      case "--help":
      case "help":
        console.log(HELP);
        return 0;
      default:
        fail(args, `unknown subcommand: ${args.subcommand}`, 1);
    }
  } catch (error) {
    if (error instanceof ScriptExit) {
      if (error.code === 2 && error.message !== "")
        writeFailureStatus(args);
      if (error.message !== "") {
        if (error.json)
          console.log(JSON.stringify({ ok: false, error: error.message }));
        console.error(`error: ${error.message}`);
      }
      return error.code;
    }
    const message = error instanceof Error ? error.message : String(error);
    writeFailureStatus(args);
    if (args?.booleans.has("--json"))
      console.log(JSON.stringify({ ok: false, error: message }));
    console.error(`error: ${message}`);
    return 2;
  }
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  spawnRunner,
  setCommandRunner,
  scanHygiene,
  renderFindings,
  parseArgs,
  normalizeFindings,
  main,
  isHeadReviewed,
  isExplicitCleanReview,
  isCodexAuthor,
  hasCurrentCleanReview,
  hasCodeReviewRules,
  extractSeverity,
  buildRequestBody
};
