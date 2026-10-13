/**
 * Config layer resolution + loader cache (leaf module).
 *
 * Extracted from `loader.ts` so `executor-update.ts` can resolve layers and invalidate
 * the cache without importing the loader (which re-exports executor-update — a cycle).
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/ts-utils';
import type { SpurConfig } from './index';

/** Directory layout constant — the `.spur/` config directory. */
export const SPUR_CONFIG_DIR = '.spur';
/** Project config file name. */
export const SPUR_CONFIG_FILE = 'config.yaml';
/** Global user config file path (relative to home). */
export const GLOBAL_CONFIG_FILE = join(homedir(), '.config', 'spur', 'config.yaml');

/** Loader cache: cache key → in-flight/settled merged config load. */
export const spurConfigCache = new Map<string, Promise<SpurConfig>>();

/**
 * Resolve both config layers following the layered contract (ADR-015 ladder, task 0640).
 *
 * - Project layer: `<cwd>/.spur/config.yaml`.
 * - Global layer: `~/.config/spur/config.yaml` (skipped when `SPUR_SKIP_GLOBAL_CONFIG=true`,
 *   which under layering means *project layer only*).
 * - Project layer: additionally suppressed when `SPUR_SKIP_PROJECT_CONFIG=true` and the
 *   caller did not pass `cwd` (task 0817) — an explicit `cwd` always wins.
 *
 * Both keys are present when both files exist; a missing file leaves the key `undefined`.
 * When neither exists (pre-`spur init`), both are `undefined`.
 */
export interface ResolvedConfigLayers {
    /** `~/.config/spur/config.yaml` when it exists (and the skip env is unset). */
    global?: string;
    /** `<cwd>/.spur/config.yaml` when it exists (and the project-skip env did not fire). */
    project?: string;
}

/**
 * Resolve both config layer paths for a working directory: the project layer
 * (`<cwd>/.spur/config.yaml`) and the global layer (`~/.config/spur/config.yaml`).
 * Each layer is included only when its file exists; `SPUR_SKIP_GLOBAL_CONFIG=true`
 * suppresses the global layer (tests and hermetic environments).
 *
 * `SPUR_SKIP_PROJECT_CONFIG=true` suppresses the project layer, but only when the
 * caller did not pin `cwd` (task 0817): the precedence is explicit `cwd` > env skip
 * > `process.cwd()`. An explicitly-passed `cwd` names the project the caller asked
 * for and is never skipped; an unpinned call would otherwise bind the loader to
 * whatever `process.cwd()` happens to be — including a test harness's repository
 * root and its live `.spur/config.yaml`.
 */
export function resolveConfigLayers(cwd?: string): ResolvedConfigLayers {
    const layers: ResolvedConfigLayers = {};
    const skipProject = cwd === undefined && getEnvVar('SPUR_SKIP_PROJECT_CONFIG') === 'true';
    if (!skipProject) {
        const projectConfig = join(cwd ?? process.cwd(), SPUR_CONFIG_DIR, SPUR_CONFIG_FILE);
        if (existsSync(projectConfig)) layers.project = projectConfig;
    }
    if (getEnvVar('SPUR_SKIP_GLOBAL_CONFIG') !== 'true' && existsSync(GLOBAL_CONFIG_FILE)) {
        layers.global = GLOBAL_CONFIG_FILE;
    }
    return layers;
}

/** Drop cached loader entries so the next {@link loadSpurConfig} re-reads from disk. */
export function invalidateSpurConfig(configPath?: string): void {
    if (configPath === undefined) {
        spurConfigCache.clear();
        return;
    }
    for (const key of spurConfigCache.keys()) {
        // The path may sit at the key head (primary layer) or in the global slot.
        if (key.startsWith(`${configPath}\0`) || key.includes(`\0${configPath}\0`)) {
            spurConfigCache.delete(key);
        }
    }
}
