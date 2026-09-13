# taste-refactoring-architect

A reusable agent skill for system architecture refactoring with one central goal:

**Simplify the architecture while preserving all required features and delivery qualities.**

It uses a graded intervention model instead of treating every issue as a redesign problem:

- A0 KEEP
- A1 DIRECT REMOVE
- A2 SUGGEST REMOVE
- A3 CONSOLIDATE / SIMPLIFY
- A4 SUGGEST ENHANCE
- A5 RE-BOUNDARY
- A6 SUGGEST RE-DESIGN
- A7 DEFER / OBSERVE

The package includes:
- `SKILL.md` — operational agent instructions
- `references/architecture-refactoring-playbook.md` — deeper techniques
- `references/research-basis.md` — standards/practice basis
- `checklists/daily-architecture-review.md` — quick daily checklist
- `examples/review-template.md` — reusable assessment format
- `examples/refactor-example.md` — worked example

The skill interprets **STOA** as **state-of-the-art** architecture techniques. If your organization means a particular named STOA methodology, customize `research-basis.md` and map its rules into the action ladder.
