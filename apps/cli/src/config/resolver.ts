/**
 * Config file resolution for the Spur CLI.
 *
 * Resolution order (confirmed in task 0028 Design):
 * 1. Project `.spur/config.yaml` (cwd).
 * 2. Fallback to global `~/.config/spur/config.yaml` when the project file is missing.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLI_CONFIG } from '../config';

/** Global user config file path (relative to home). */
const GLOBAL_CONFIG_FILE = join(homedir(), '.config', 'spur', 'config.yaml');

/**
 * Resolve the config file path following the project→global fallback order.
 *
 * Returns `undefined` when neither file exists (e.g. before `spur init`).
 * Set `SPUR_SKIP_GLOBAL_CONFIG=true` to skip the global fallback.
 */
export function resolveConfigFile(cwd?: string): string | undefined {
    const projectConfig = join(cwd ?? process.cwd(), CLI_CONFIG.configDir, 'config.yaml');
    if (existsSync(projectConfig)) return projectConfig;
    if (process.env.SPUR_SKIP_GLOBAL_CONFIG === 'true') return undefined;
    if (existsSync(GLOBAL_CONFIG_FILE)) return GLOBAL_CONFIG_FILE;
    return undefined;
}
