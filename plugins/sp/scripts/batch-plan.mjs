#!/usr/bin/env node
// @bun

// plugins/sp/scripts/batch-plan.ts
import { readFileSync } from "fs";

// plugins/sp/lib/plan-projection.generated.mjs
function planLetter(index) {
  if (!Number.isInteger(index) || index < 0 || index > 25) {
    throw new Error(`plan letter out of range: ${index} (expected 0..25)`);
  }
  return String.fromCharCode(65 + index);
}
function planChild(parent, index) {
  if (!Number.isInteger(index) || index < 0 || index > 8) {
    throw new Error(`plan child index out of range: ${index} (expected 0..8 under ${parent})`);
  }
  if (parent.length !== 1 || !/[A-Z]/.test(parent)) {
    throw new Error(`plan child parent must be a single letter: ${parent}`);
  }
  return `${parent}${index + 1}`;
}
var PREPARE_ID = "prepare";
var REPORT_ID = "report";
var PHASE_ID_PREFIX = "phase.";
var TASK_ID_PREFIX = "task.";
var WAVE_SIZE = 24;
var TITLE_CAP = 60;
function isStateMachine(def) {
  return def.kind !== "transition-flow" && def.kind !== "dag";
}
function hasDisplay(s) {
  return s.display !== undefined;
}
function resolvePhaseTitle(states, phase) {
  for (const s of states) {
    if (s.display?.phase === phase && s.display.phaseTitle !== undefined)
      return s.display.phaseTitle;
  }
  return phase;
}
function childText(label, title, id) {
  return id.startsWith("prepare.") || id.startsWith("task.") || id === PREPARE_ID || id === REPORT_ID ? `${label} ${title}` : `${label} ${title} · ${id}`;
}
function buildPhasedPlan(def) {
  if (!isStateMachine(def))
    return null;
  const annotated = def.states.filter(hasDisplay);
  if (annotated.length === 0)
    return null;
  const items = [
    { label: "A", id: PREPARE_ID, outcome: "pending", title: "Prepare", text: "A Prepare" },
    {
      label: "A1",
      id: "prepare.1",
      outcome: "pending",
      parent: "A",
      title: "Quick readiness",
      text: "A1 Quick readiness"
    },
    { label: "A2", id: "prepare.2", outcome: "pending", parent: "A", title: "Prepare Git", text: "A2 Prepare Git" },
    {
      label: "A3",
      id: "prepare.3",
      outcome: "pending",
      parent: "A",
      title: "Publish plan",
      text: "A3 Publish plan"
    }
  ];
  const phases = [];
  for (const s of def.states) {
    if (s.display !== undefined && !phases.includes(s.display.phase))
      phases.push(s.display.phase);
  }
  for (const [phaseIndex, phase] of phases.entries()) {
    const letter = planLetter(phaseIndex + 1);
    const phaseTitle = resolvePhaseTitle(def.states, phase);
    items.push({
      label: letter,
      id: `${PHASE_ID_PREFIX}${phase}`,
      outcome: "pending",
      title: phaseTitle,
      text: `${letter} ${phaseTitle}`
    });
    let childIndex = 0;
    for (const s of def.states) {
      if (s.display?.phase !== phase || s.display.show === "on-entry")
        continue;
      const label = planChild(letter, childIndex++);
      const title = s.display.title ?? s.id;
      items.push({
        label,
        id: s.id,
        outcome: "pending",
        parent: letter,
        title,
        text: childText(label, title, s.id)
      });
    }
  }
  return items;
}
function validatePhaseTable(def) {
  if (!isStateMachine(def))
    return [];
  const annotated = def.states.filter(hasDisplay);
  if (annotated.length === 0)
    return [];
  const errors = [];
  const terminals = new Set(def.terminalStates ?? []);
  for (const s of def.states) {
    if (s.display === undefined && !terminals.has(s.id)) {
      errors.push(`state "${s.id}" has no display phase — every non-terminal state must declare display when any state does`);
    }
    if (s.display !== undefined && terminals.has(s.id)) {
      errors.push(`terminal state "${s.id}" must not declare display`);
    }
  }
  const phases = [];
  for (const s of annotated) {
    if (!phases.includes(s.display.phase))
      phases.push(s.display.phase);
  }
  if (phases.length > 25) {
    errors.push(`${phases.length} phases exceed the 25 plan letters (B-Z); split the workflow or drop phase rows`);
  }
  for (const phase of phases) {
    const members = annotated.filter((s) => s.display.phase === phase);
    if (members.length > 9) {
      errors.push(`phase "${phase}" has ${members.length} states — at most 9 digit children fit under one letter`);
    }
    const titles = [...new Set(members.map((s) => s.display.phaseTitle).filter((t) => t !== undefined))];
    if (titles.length > 1) {
      errors.push(`phase "${phase}" has conflicting phaseTitle values: ${titles.map((t) => `"${t}"`).join(", ")}`);
    }
  }
  return errors;
}
function insertOnEntry(items, stateId, def) {
  if (!isStateMachine(def))
    return items;
  if (items.some((i) => i.id === stateId))
    return items;
  const display = def.states.find((s) => s.id === stateId)?.display;
  if (display === undefined || (def.terminalStates ?? []).includes(stateId))
    return items;
  const phaseRow = items.find((i) => i.id === `${PHASE_ID_PREFIX}${display.phase}`);
  if (phaseRow === undefined)
    return items;
  const children = items.filter((i) => i.parent === phaseRow.label);
  const label = planChild(phaseRow.label, children.length);
  const title = display.title ?? stateId;
  const item = {
    label,
    id: stateId,
    outcome: "pending",
    parent: phaseRow.label,
    title,
    text: childText(label, title, stateId)
  };
  const last = children.at(-1) ?? phaseRow;
  const at = items.indexOf(last) + 1;
  return [...items.slice(0, at), item, ...items.slice(at)];
}
function truncateTitle(name) {
  if (name.length <= TITLE_CAP)
    return name;
  return `${name.slice(0, TITLE_CAP - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}
function buildBatchPlan(tasks) {
  const waves = [];
  for (let offset = 0;offset < tasks.length; offset += WAVE_SIZE) {
    const items = [
      { label: "A", id: PREPARE_ID, outcome: "pending", title: "Prepare batch", text: "A Prepare batch" },
      {
        label: "A1",
        id: "prepare.1",
        outcome: "pending",
        parent: "A",
        title: "Resolve and freeze task set",
        text: "A1 Resolve and freeze task set"
      },
      {
        label: "A2",
        id: "prepare.2",
        outcome: "pending",
        parent: "A",
        title: "Order by dependencies",
        text: "A2 Order by dependencies"
      },
      {
        label: "A3",
        id: "prepare.3",
        outcome: "pending",
        parent: "A",
        title: "Prepare Git",
        text: "A3 Prepare Git"
      },
      {
        label: "A4",
        id: "prepare.4",
        outcome: "pending",
        parent: "A",
        title: "Publish plan",
        text: "A4 Publish plan"
      }
    ];
    tasks.slice(offset, offset + WAVE_SIZE).forEach((task, i) => {
      const label = planLetter(i + 1);
      const title = `${task.wbs} ${truncateTitle(task.name)}`;
      items.push({
        label,
        id: `${TASK_ID_PREFIX}${task.wbs}`,
        outcome: "pending",
        title,
        text: `${label} ${title}`
      });
    });
    items.push({ label: "Z", id: REPORT_ID, outcome: "pending", title: "Batch report", text: "Z Batch report" });
    waves.push(items);
  }
  return waves;
}
function taskPhaseChildren(taskLetter, plan) {
  if (!Array.isArray(plan))
    return [];
  return plan.filter((i) => i.id.startsWith(PHASE_ID_PREFIX) && i.label.length === 1).map((row, i) => {
    const label = planChild(taskLetter, i);
    return {
      label,
      id: row.id,
      outcome: row.outcome,
      parent: taskLetter,
      title: row.title,
      text: `${label} ${row.title}`
    };
  });
}
function hostStatus(outcome) {
  if (outcome === "completed")
    return "completed";
  if (outcome === "active")
    return "in_progress";
  return "pending";
}
function hostText(item) {
  const hostDecided = item.outcome === "skipped" || item.outcome === "failed" || item.outcome === "unattempted" || item.outcome === "blocked";
  return hostDecided ? `${item.text} [${item.outcome}]` : item.text;
}

// plugins/sp/scripts/batch-plan.ts
var BATCH_PLAN_USAGE = "usage: batch-plan.ts waves --tasks <tasks.json> | task-children --letter <A-Z> --plan <plan.json>";
function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function isBatchTask(value) {
  return typeof value === "object" && value !== null && typeof value.wbs === "string" && typeof value.name === "string";
}
function main(argv) {
  const mode = argv[0];
  if (mode === "waves") {
    if (argv[1] !== "--tasks" || argv[2] === undefined) {
      process.stderr.write(`${BATCH_PLAN_USAGE}
`);
      return 2;
    }
    let tasks;
    try {
      tasks = readJsonFile(argv[2]);
    } catch (error) {
      process.stderr.write(`batch-plan: cannot read ${argv[2]} \u2014 ${error instanceof Error ? error.message : String(error)}
`);
      return 1;
    }
    if (!Array.isArray(tasks) || !tasks.every(isBatchTask)) {
      process.stderr.write(`batch-plan: --tasks file must be a JSON array of {wbs, name}
`);
      return 1;
    }
    process.stdout.write(`${JSON.stringify({ waves: buildBatchPlan(tasks) })}
`);
    return 0;
  }
  if (mode === "task-children") {
    let letter = "";
    let planPath = "";
    for (let i = 1;i + 1 < argv.length; i += 2) {
      if (argv[i] === "--letter")
        letter = argv[i + 1] ?? "";
      else if (argv[i] === "--plan")
        planPath = argv[i + 1] ?? "";
    }
    if (!/^[A-Z]$/.test(letter) || planPath === "") {
      process.stderr.write(`${BATCH_PLAN_USAGE}
`);
      return 2;
    }
    let payload;
    try {
      payload = readJsonFile(planPath);
    } catch (error) {
      process.stderr.write(`batch-plan: cannot read ${planPath} \u2014 ${error instanceof Error ? error.message : String(error)}
`);
      return 1;
    }
    const plan = Array.isArray(payload) ? payload : payload.plan;
    if (!Array.isArray(plan)) {
      process.stderr.write("batch-plan: --plan file must be a plan array or a todo --json payload with a `plan` field\n");
      return 1;
    }
    process.stdout.write(`${JSON.stringify(taskPhaseChildren(letter, plan))}
`);
    return 0;
  }
  process.stderr.write(`${BATCH_PLAN_USAGE}
`);
  return 2;
}
{
  process.exit(main(process.argv.slice(2)));
}
export {
  validatePhaseTable,
  taskPhaseChildren,
  planLetter,
  planChild,
  main,
  insertOnEntry,
  hostText,
  hostStatus,
  buildPhasedPlan,
  buildBatchPlan,
  BATCH_PLAN_USAGE
};
