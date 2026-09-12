#!/usr/bin/env node
// @bun

// plugins/sp/scripts/idea-handoff.ts
var libUrl = new URL("../lib/idea-handoff.generated.mjs", import.meta.url).href;
async function loadHandoffLib() {
  return await import(libUrl);
}
var IDEA_HANDOFF_USAGE = "usage: idea-handoff.ts  (env: __runId, featureId, optional spurBin) \u2014 no subcommands";
async function main(argv, env = process.env) {
  if (argv.length > 0) {
    process.stderr.write(`${IDEA_HANDOFF_USAGE}
`);
    return 2;
  }
  const { runIdeaHandoffCli } = await loadHandoffLib();
  const outcome = await runIdeaHandoffCli(env);
  return outcome.exitCode;
}
{
  process.exit(await main(process.argv.slice(2)));
}
export {
  main,
  loadHandoffLib,
  IDEA_HANDOFF_USAGE
};
