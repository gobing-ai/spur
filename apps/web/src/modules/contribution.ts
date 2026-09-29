import type { ComponentType } from 'react';

/**
 * Public authoring contract for a native (compiled React) Board module contribution
 * (A8 / task 0988 R1).
 *
 * This file is the ONE authoring source for the declaration-only `@gobing-ai/spur/board`
 * package export: `scripts/commands/emit-board-types.ts` emits `apps/cli/board/index.d.ts`
 * from it, so the published ABI cannot drift from the Board's own types. Keep it
 * type-only — no React *value* import may reach the CLI or plugin artifacts (the CLI
 * ships no React; the contributor supplies compatible React types through its own
 * devDependencies).
 *
 * Module metadata (id/name/icon/route) is deliberately absent: it is project
 * configuration (one selection authority), while this shape carries only what the
 * renderer needs to mount a contribution.
 */
export interface BoardModuleContribution {
    /** Contribution protocol version this Board accepts. */
    readonly apiVersion: 1;
    /**
     * Workspace component. Rendered inside the Board's React tree with the Board's own
     * React instance — it must not call `createRoot`, and no private Board context is
     * exported to it.
     */
    readonly component: ComponentType;
    /** Optional companion the Board's right panel renders while this module is active. */
    readonly rightPanelComponent?: ComponentType;
}

/**
 * The named export a native Board module entry must publish.
 *
 * Declared rather than implemented: `@gobing-ai/spur/board` is a declaration-only export,
 * not a runtime SDK (consumers import its types; their compiled ESM entry exports this
 * name for the renderer).
 */
export declare const webModule: BoardModuleContribution;
