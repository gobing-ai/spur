#!/usr/bin/env node
// @bun

// plugins/sp/scripts/session-timeline.ts
import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// plugins/sp/lib/env.ts
function getEnvVars() {
  return process.env;
}

// plugins/sp/scripts/session-timeline.ts
var SESSION_ID = /^[A-Za-z0-9_-]+$/;
var PROMPT_EXCERPT = 80;
var OPERATOR_TOOLS = new Set(["AskUserQuestion"]);
var zeroTokens = () => ({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 });
function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor(s % 3600 / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
var render = (span) => ({
  ...span,
  work: formatDuration(span.workMs),
  wait: formatDuration(span.waitMs)
});
function promptText(row) {
  if (row.type !== "user" || row.isMeta || row.isCompactSummary)
    return;
  const content = row.message?.content;
  if (typeof content === "string")
    return content;
  if (!Array.isArray(content) || content.some((b) => b.type === "tool_result"))
    return;
  return content.find((b) => b.type === "text")?.text;
}
function sumTokens(all) {
  const total = zeroTokens();
  for (const t of all)
    for (const k of Object.keys(total))
      total[k] += t[k];
  return total;
}
function sumSpans(spans) {
  return {
    workMs: spans.reduce((n, s) => n + s.workMs, 0),
    waitMs: spans.reduce((n, s) => n + s.waitMs, 0),
    toolCalls: spans.reduce((n, s) => n + s.toolCalls, 0),
    tokens: sumTokens(spans.map((s) => s.tokens))
  };
}
function parseGroups(spec, count) {
  let next = 1;
  return spec.split(",").map((part) => {
    const [a = Number.NaN, b = a] = part.trim().split("-").map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < next || b < a || b > count) {
      throw new Error(`invalid --group "${part}" (segments 1-${count}, ascending, no overlap)`);
    }
    next = b + 1;
    return [a, b];
  });
}
function buildTimeline(lines, group) {
  const open = [];
  let skippedLines = 0;
  for (const line of lines) {
    if (!line.trim())
      continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skippedLines++;
      continue;
    }
    const ts = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
    if (Number.isNaN(ts))
      continue;
    const prompt = promptText(row);
    if (prompt !== undefined) {
      const fresh = { asks: new Map, toolIds: new Set, messages: new Map };
      open.push({ start: ts, prompt, last: ts, askMs: 0, ...fresh });
      continue;
    }
    const seg = open.at(-1);
    if (!seg)
      continue;
    seg.last = Math.max(seg.last, ts);
    const blocks = Array.isArray(row.message?.content) ? row.message.content : [];
    for (const b of blocks) {
      if (b.type === "tool_use" && b.id) {
        seg.toolIds.add(b.id);
        if (b.name && OPERATOR_TOOLS.has(b.name))
          seg.asks.set(b.id, ts);
      } else if (b.type === "tool_result" && b.tool_use_id && seg.asks.has(b.tool_use_id)) {
        seg.askMs += ts - (seg.asks.get(b.tool_use_id) ?? ts);
      }
    }
    const u = row.message?.usage;
    if (row.type === "assistant" && u && row.message?.id) {
      seg.messages.set(row.message.id, {
        input: u.input_tokens ?? 0,
        cacheCreate: u.cache_creation_input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        output: u.output_tokens ?? 0
      });
    }
  }
  const segments = open.map((seg, i) => {
    const next = open[i + 1]?.start;
    const idle = next === undefined ? 0 : Math.max(0, next - seg.last);
    const oneLine = seg.prompt.replace(/\s+/g, " ").trim();
    return render({
      index: i + 1,
      start: new Date(seg.start).toISOString(),
      prompt: oneLine.length > PROMPT_EXCERPT ? `${oneLine.slice(0, PROMPT_EXCERPT)}\u2026` : oneLine,
      workMs: seg.last - seg.start - seg.askMs,
      waitMs: idle + seg.askMs,
      toolCalls: seg.toolIds.size,
      tokens: sumTokens([...seg.messages.values()])
    });
  });
  const first = open[0];
  const last = open.at(-1);
  const elapsedMs = first && last ? last.last - first.start : 0;
  const timeline = {
    available: true,
    segments,
    totals: render({ ...sumSpans(segments), elapsedMs, elapsed: formatDuration(elapsedMs) }),
    skippedLines
  };
  if (group) {
    timeline.stages = parseGroups(group, segments.length).map(([a, b]) => render({ ...sumSpans(segments.slice(a - 1, b)), segments: a === b ? `${a}` : `${a}-${b}` }));
  }
  return timeline;
}
function resolveTranscript(env, projectsRoot = join(homedir(), ".claude", "projects"), override) {
  if (override)
    return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: "no transcript" };
  const id = env.CLAUDE_CODE_SESSION_ID;
  if (!id)
    return { ok: false, reason: "no host session id (CLAUDE_CODE_SESSION_ID); pass --transcript <path>" };
  if (!SESSION_ID.test(id))
    return { ok: false, reason: "refusing a session id with path characters" };
  if (!existsSync(projectsRoot))
    return { ok: false, reason: `no transcript root ${projectsRoot}` };
  for (const dir of readdirSync(projectsRoot)) {
    const path = join(projectsRoot, dir, `${id}.jsonl`);
    if (existsSync(path))
      return { ok: true, path };
  }
  return { ok: false, reason: `no transcript for session ${id}` };
}
var SESSION_TIMELINE_USAGE = 'usage: session-timeline [--transcript <path>] [--group "1-3,4,..."]';
function main(argv, env = getEnvVars(), write = (s) => process.stdout.write(s), projectsRoot) {
  let transcript;
  let group;
  for (let i = 0;i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--transcript" && argv[i + 1])
      transcript = argv[++i];
    else if (arg === "--group" && argv[i + 1])
      group = argv[++i];
    else if (arg === "--spur-bin" && argv[i + 1])
      i++;
    else {
      process.stderr.write(`${SESSION_TIMELINE_USAGE}
`);
      return 2;
    }
  }
  const resolved = resolveTranscript(env, projectsRoot, transcript);
  if (!resolved.ok) {
    write(`${JSON.stringify({ available: false, reason: resolved.reason })}
`);
    return 0;
  }
  try {
    const timeline = buildTimeline(readFileSync(resolved.path, "utf8").split(`
`), group);
    write(`${JSON.stringify({ ...timeline, transcript: resolved.path })}
`);
    return 0;
  } catch (error) {
    process.stderr.write(`session-timeline: ${error.message}
`);
    return 2;
  }
}
process.exit(main(process.argv.slice(2)));
export {
  resolveTranscript,
  parseGroups,
  main,
  formatDuration,
  buildTimeline,
  SESSION_TIMELINE_USAGE
};
