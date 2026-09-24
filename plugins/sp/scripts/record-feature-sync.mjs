#!/usr/bin/env node
// plugins/sp/scripts/record-feature-sync.ts
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";

// plugins/sp/lib/env.ts
function getEnvVar(name, fallback) {
  const raw = process.env[name];
  return raw === undefined ? fallback : raw;
}

// plugins/sp/scripts/record-feature-sync.ts
function resolveSpurBin(argv) {
  const flag = argv.indexOf("--spur-bin");
  const value = flag !== -1 ? argv[flag + 1] : undefined;
  return value ?? getEnvVar("spurBin") ?? "spur";
}
function main() {
  const argv = process.argv.slice(2);
  const spurBin = resolveSpurBin(argv);
  const wbs = getEnvVar("wbs") ?? "";
  if (wbs.length === 0) {
    console.error("record-feature-sync: env `wbs` is required");
    process.exit(0);
  }
  const reportPath = `.spur/run/${wbs}-report.txt`;
  const report = (line) => {
    appendFileSync(reportPath, `${line}
`);
  };
  const show = spawnSync(spurBin, ["task", "show", wbs, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  let featureId = "";
  try {
    const parsed = JSON.parse(show.stdout ?? "");
    featureId = String(parsed.feature_id ?? parsed.frontmatter?.feature_id ?? "");
  } catch {
    featureId = "";
  }
  if (featureId.length === 0) {
    report(`Orphan task ${wbs} — no feature_id linked — proposal: consider linking to a parent feature.`);
    return;
  }
  if (existsSync("plugins/sp/scripts/feature-sync-bounded.ts")) {
    spawnSync("bun", ["plugins/sp/scripts/feature-sync-bounded.ts", featureId, "--spur-bin", spurBin, "--json"], {
      stdio: "inherit"
    });
    return;
  }
  const staged = spawnSync("superskill", ["script", "path", "sp", "feature-sync-bounded.mjs"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const stagedPath = (staged.stdout ?? "").trim();
  if (staged.status === 0 && stagedPath.length > 0 && existsSync(stagedPath)) {
    spawnSync("node", [stagedPath, featureId, "--spur-bin", spurBin, "--json"], { stdio: "inherit" });
    return;
  }
  spawnSync(spurBin, ["feature", "sync", featureId, "--json"], { stdio: "inherit" });
}
main();
