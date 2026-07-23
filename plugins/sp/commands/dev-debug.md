---
description: "Systematic debugging protocol — reproduce, isolate, diagnose root cause, apply minimal fix, and verify with regression tests"
argument-hint: "\"<symptom | failing command>\" [--scope <path>] [--task [<wbs>]]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Debug

Wraps the **sp:sys-debugging** skill.

## Usage

/sp:dev-debug "<symptom | failing command>" [--scope <path>] [--task [<wbs>]]

## Implementation

- `Skill(skill="sp:sys-debugging", args="$ARGUMENTS")`
