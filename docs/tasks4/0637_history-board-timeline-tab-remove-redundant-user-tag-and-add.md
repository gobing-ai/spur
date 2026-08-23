---
schema_version: 1
name: "History Board Timeline Tab: Remove redundant USER tag and add token breakdown tooltip to UserIcon in prompt cards"
status: done
template: feature-impl
created_at: 2026-08-23T14:12:24.823Z
updated_at: "2026-08-23T14:18:04.086Z"
feature_id: E8
---

## 0637. History Board Timeline Tab: Remove redundant USER tag and add token breakdown tooltip to UserIcon in prompt cards

### Background
Following feedback on the History Board Timeline tab prompt card design:

1. **Remove Redundant `USER` Text Tag:**
   - The user prompt card already begins with a distinct vector `<UserIcon />` glyph in cyan. The adjacent static text badge `USER` is redundant and occupies valuable horizontal space on dense single-line cards.
   - Remove the `USER` badge, leaving the icon as the clean, sole visual anchor for user prompt cards.

2. **Add Token Breakdown Tooltip on UserIcon (`UserTokenBadge`):**
   - Similar to `ToolTokenBadge` on tool-using cards, user prompt events carry input/cache/output tokens (`freshInputTokens`, `cacheReadTokens`, `outputTokens`).
   - Wrap the `<UserIcon />` in an interactive accessible button (`UserTokenBadge`) with a hover/focus popover tooltip (`z-50`, `relative z-20`) displaying the full token breakdown: `📥 Fresh input`, `💾 Cache read`, `📤 Output`, and `⚡ Total`.
### Requirements
- **R1 (Remove Redundant USER Badge):** Remove the text `USER` badge from user prompt cards in `TimelineTab.tsx`. The leading `<UserIcon />` alone serves as the prompt card anchor.
- **R2 (Interactive UserTokenBadge with Token Breakdown):** Implement `UserTokenBadge` wrapping `<UserIcon />` in an accessible trigger button with an unclipped hover/focus popover tooltip (`z-50`, `relative z-20`, Escape dismissal) that displays `📥 Fresh input`, `💾 Cache read`, `📤 Output`, and `⚡ Total`.
- **R3 (Component Test Suite):** Update tests in `components.test.tsx` verifying that prompt cards no longer contain the text `USER` badge, and asserting that focusing, hovering, and blurring `UserTokenBadge` reveals and hides the token breakdown popover.
- **R4 (Design Documentation Synchronization):** Synchronize History Board module specifications in `docs/design/history-board-module.md` and `docs/04_DESIGN.md`.
- **R5 (Quality Gate & Verification):** Pass comprehensive quality gates `bun run spur-check` (6,233+ tests green), `bun run test-cf`, `bun run build`, and `spur task check --corpus`.
### Acceptance Criteria
```gherkin
Feature: History Board Timeline Prompt Card Token Breakdown & Redundant Tag Elimination

  Scenario: Timeline tab inspects session execution with Agent and Model tags
    Given a session record is selected from the dropdown or deep-linked from the Sessions table
    When the Timeline tab is viewed
    Then the header displays session ID, Coding Agent badge, Model badge, duration, and token metrics
    And chronological event rows render user prompts on the right and tool/command events on the left
    And each tool/command event displays an [Agent] and [Model] tag alongside latency duration and token telemetry
    And clicking an event toggles the full input/output payload and execution metadata
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
#### 1. UserTokenBadge Component
```tsx
const UserTokenBadge: React.FC<{
    freshInputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    tooltipId: string;
}> = ({ freshInputTokens, cacheReadTokens, outputTokens, tooltipId }) => {
    const [open, setOpen] = useState(false);
    const total = tokenLoad(freshInputTokens, cacheReadTokens, outputTokens);
    return (
        <div className="relative inline-flex items-center z-20">
            <button
                type="button"
                aria-label="Show user prompt token breakdown"
                aria-describedby={tooltipId}
                data-testid={`timeline-user-badge-${tooltipId}`}
                className="p-1 rounded bg-base-300 text-cyan-400 shrink-0 hover:bg-base-content/10 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary transition-colors cursor-pointer"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={(e) => {
                    if (e.key === 'Escape') setOpen(false);
                }}
            >
                <UserIcon />
            </button>
            <div
                id={tooltipId}
                role="tooltip"
                data-testid={tooltipId}
                className={`absolute left-0 top-full z-50 mt-1.5 w-52 p-2 rounded-lg bg-base-300 border border-base-content/20 shadow-2xl text-[11px] font-mono leading-relaxed pointer-events-none ${
                    open ? 'block' : 'hidden'
                }`}
            >
                <div className="font-bold text-base-content mb-1">User Prompt Tokens</div>
                <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-base-content/80">
                    <span className="text-base-content/60">📥 Fresh input:</span>
                    <span>{fmtTok(freshInputTokens)}</span>
                    <span className="text-base-content/60">💾 Cache read:</span>
                    <span className="text-cyan-400">{fmtTok(cacheReadTokens)}</span>
                    <span className="text-base-content/60">📤 Output:</span>
                    <span>{fmtTok(outputTokens)}</span>
                    <span className="text-base-content/60 border-t border-base-content/10 pt-0.5">⚡ Total:</span>
                    <span className="font-bold border-t border-base-content/10 pt-0.5 text-primary">{fmtTok(total)}</span>
                </div>
            </div>
        </div>
    );
};
```

#### 2. User Prompt Card Markup Refinement
Eliminate `<span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-700 text-slate-100 shrink-0">USER</span>`. The card header becomes:
```tsx
<div className="flex items-center gap-2 min-w-0 flex-1">
    <UserTokenBadge
        freshInputTokens={ev.freshInputTokens}
        cacheReadTokens={ev.cacheReadTokens}
        outputTokens={ev.outputTokens}
        tooltipId={`user-tt-${block.turnIndex}-${ev.seq}`}
    />
    <span className="font-mono text-xs font-semibold text-base-content/90 truncate min-w-0">
        {summary}
    </span>
</div>
```
### Plan
- [x] Implement `UserTokenBadge` in `TimelineTab.tsx` with hover/focus accessible tooltip displaying token breakdown (R2).
- [x] Remove redundant static `USER` text badge from user prompt cards in `TimelineTab.tsx` (R1).
- [x] Update `components.test.tsx` assertions verifying the removal of `USER` text badge and testing `UserTokenBadge` hover/focus popover behavior (R3).
- [x] Synchronize satellite documentation in `docs/design/history-board-module.md` and `docs/04_DESIGN.md` (R4).
- [x] Run full quality gates (`bun run autofix && bun run spur-check`), Cloudflare worker test (`bun run test-cf`), build (`bun run build`), and corpus check (`bun run corpus-check`) (R5).
### Solution
Curated change-map — one row per changed file, anchored at the primary symbol each change implements.

| Change | Anchor |
|--------|--------|
| `UserTokenBadge` — added user icon trigger button with accessible hover/focus token breakdown popover (`z-50`), and removed redundant static `USER` text badge from user prompt cards | `apps/web/src/modules/history/TimelineTab.tsx:149` |
| Component test suite in `components.test.tsx` asserting removal of `USER` text badge and verifying `UserTokenBadge` hover/focus/Escape tooltip interactions | `apps/web/tests/modules/history/components.test.tsx:365` |
| Synchronized Timeline specification and task mapping in History Board module design satellite | `docs/design/history-board-module.md:10` |
| Synchronized History Board satellite reference in 04_DESIGN.md | `docs/04_DESIGN.md:66` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/history/TimelineTab.tsx:149` removes the text `USER` badge from user prompt cards, retaining `<UserIcon />` as the single clean card anchor. Verified via component tests. |
| R2 | MET | `apps/web/src/modules/history/TimelineTab.tsx:149` implements `UserTokenBadge` wrapping `<UserIcon />` with an accessible hover/focus popover tooltip (`z-50`, `relative z-20`, Escape key dismissal) displaying fresh input, cache read, output, and total token loads. |
| R3 | MET | `apps/web/tests/modules/history/components.test.tsx:365` tests `UserTokenBadge` popover interactions (focus, hover, blur, Escape) and asserts that prompt cards no longer contain the redundant text `USER` badge across 15 passing tests. |
| R4 | MET | `docs/design/history-board-module.md:10` is synchronized with History Board module specifications and satellite task mapping. |
| R5 | MET | `apps/web/tests/modules/history/components.test.tsx:365` confirms comprehensive verification; full quality gates `bun run spur-check` (6,233 pass across 340 test files), `bun run test-cf` (1 pass), `bun run build`, and `spur task check --corpus` all pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Timeline tab inspects session execution with Agent and Model tags | MET | test | `bun test apps/web/tests/modules/history/components.test.tsx` exited 0: 15 pass, 186 assertions. `bun run spur-check` exited 0: 6233 pass; `bun run test-cf` and `bun run build` exited 0. Static review at `apps/web/src/modules/history/TimelineTab.tsx:149` confirms pure Tailwind implementation. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Phase | Focus | Status | Findings |
|---|---|---|---|
| P1 | Functional Traceability | PASS | All 4 requirements (R1–R4) verified against code and test assertions. Redundant USER tag removed, UserTokenBadge renders with accessible token breakdown popover, component tests pass, and quality gates pass. |
| P2 | SECUA & Quality | PASS | No security vulnerabilities, zero new dependencies, keyboard navigation with Escape dismissal, reduced motion respected, pure Tailwind CSS without DaisyUI leaks. |
| P3 | Architecture Depth | PASS | Single-file UI refinement in `TimelineTab.tsx`. Token breakdown tooltip geometry and stacking contexts match `ToolTokenBadge` and `AgentBadge`. |
| P4 | Documentation & Parity | PASS | Synchronized `docs/design/history-board-module.md` (frontmatter, Section 3.2, Section 5) and `docs/04_DESIGN.md` satellite index. |
### References
- Feature [E8](../../features/E8_history-board-module-analytics-summary-execution-timeline-sessions-forensic-insights-and-agent-sources-registry.md)
- History Board Design Satellite [`docs/design/history-board-module.md`](../design/history-board-module.md)
- Prior task [0636](0636_history-board-timeline-tab-default-filter-checkboxes-to-chec.md)
- Prior task [0635](0635_history-board-timeline-tab-compact-antigravity-cli-stream-pe.md)
- Non-UI Surface Design [`docs/04_DESIGN.md`](../04_DESIGN.md)
### History
- 2026-08-23T14:13:12.007Z todo → wip (system)
- 2026-08-23T14:18:03.725Z wip → testing (system)
- 2026-08-23T14:18:04.086Z testing → done (system)
