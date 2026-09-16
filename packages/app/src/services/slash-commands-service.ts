import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
    getSlashCommandsFilePath,
    type SlashCommandCategory,
    type SlashCommandItem,
    type SlashCommandsFile,
    slashCommandsFileSchema,
} from '@gobing-ai/spur-config';
import { parse } from 'yaml';

export type { SlashCommandCategory, SlashCommandItem, SlashCommandsFile };

/**
 * Standard catalog of built-in Claude Code slash commands.
 * Mirrors the native CLI primitives shipped with Anthropic Claude Code.
 */
export const BUILTIN_CLAUDE_COMMANDS: readonly SlashCommandItem[] = [
    {
        name: '/help',
        description: 'View available commands, tools, and usage hints',
        category: 'sys',
        argumentHint: '[command]',
        tags: ['builtin', 'sys', 'help'],
        source: 'builtin',
    },
    {
        name: '/clear',
        description: 'Clear conversation history and reset context window',
        category: 'sys',
        tags: ['builtin', 'sys', 'clear'],
        source: 'builtin',
    },
    {
        name: '/compact',
        description: 'Purge execution trace and condense context window',
        category: 'sys',
        argumentHint: '[focus]',
        tags: ['builtin', 'sys', 'compact', 'context'],
        source: 'builtin',
    },
    {
        name: '/cost',
        description: 'Inspect token breakdown and USD expenditure',
        category: 'sys',
        tags: ['builtin', 'sys', 'cost', 'tokens'],
        source: 'builtin',
    },
    {
        name: '/doctor',
        description: 'Run diagnostic health checks on environment and tools',
        category: 'sys',
        tags: ['builtin', 'sys', 'doctor', 'health'],
        source: 'builtin',
    },
    {
        name: '/init',
        description: 'Initialize project instructions, settings and guidelines',
        category: 'harness',
        tags: ['builtin', 'harness', 'init'],
        source: 'builtin',
    },
    {
        name: '/review',
        description: 'Inspect staged git diff, verify test coverage & lint',
        category: 'git',
        argumentHint: '[target] [--cached]',
        tags: ['builtin', 'git', 'review'],
        source: 'builtin',
    },
    {
        name: '/commit',
        description: 'Draft conventional commit message from staged hunks',
        category: 'git',
        argumentHint: '[--all] [-m <message>]',
        tags: ['builtin', 'git', 'commit'],
        source: 'builtin',
    },
    {
        name: '/terminal',
        description: 'Run isolated bash execution in sandbox mirror',
        category: 'sys',
        argumentHint: '[command]',
        tags: ['builtin', 'sys', 'terminal', 'bash'],
        source: 'builtin',
    },
    {
        name: '/revert',
        description: 'Undo last agent file changes or restore git stash',
        category: 'git',
        argumentHint: '[stash-id | file]',
        tags: ['builtin', 'git', 'revert'],
        source: 'builtin',
    },
    {
        name: '/resume',
        description: 'Resume paused background agent run',
        category: 'dev',
        argumentHint: '[run-id]',
        tags: ['builtin', 'dev', 'resume'],
        source: 'builtin',
    },
    {
        name: '/bug',
        description: 'Report a bug or issue with diagnostic transcript',
        category: 'sys',
        argumentHint: '[description]',
        tags: ['builtin', 'sys', 'bug'],
        source: 'builtin',
    },
    {
        name: '/config',
        description: 'View or update local/global configuration settings',
        category: 'sys',
        argumentHint: '[key] [value]',
        tags: ['builtin', 'sys', 'config'],
        source: 'builtin',
    },
    {
        name: '/login',
        description: 'Authenticate account and refresh API credentials',
        category: 'sys',
        tags: ['builtin', 'sys', 'login', 'auth'],
        source: 'builtin',
    },
    {
        name: '/logout',
        description: 'Sign out of current account and remove stored session',
        category: 'sys',
        tags: ['builtin', 'sys', 'logout', 'auth'],
        source: 'builtin',
    },
];

/** Return a copy of built-in Claude Code commands. */
export function getBuiltinClaudeCommands(): SlashCommandItem[] {
    return BUILTIN_CLAUDE_COMMANDS.map((cmd) => ({ ...cmd }));
}

/**
 * Deduce a command category from the command name or stem.
 */
export function deduceCommandCategory(nameOrStem: string): SlashCommandCategory {
    const lower = nameOrStem.toLowerCase();
    if (/(git|commit|review|revert|pr-review|diff|branch|stash)/.test(lower)) {
        return 'git';
    }
    if (/(rule|workflow|init|harness|spur|plan|run|verify|wrap|refine|parallel|idea)/.test(lower)) {
        return 'harness';
    }
    if (/(doctor|cost|compact|clear|terminal|\bbug\b|config|login|logout|sys|status|ps)/.test(lower)) {
        return 'sys';
    }
    return 'dev';
}

/**
 * Locate plugins/sp/commands directory starting from startDir and walking upwards.
 */
export function findPluginsSpCommandsDir(startDir: string = process.cwd()): string | null {
    let current = resolve(startDir);
    while (true) {
        try {
            const candidate = join(current, 'plugins', 'sp', 'commands');
            if (existsSync(candidate)) {
                return candidate;
            }
        } catch {
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return null;
}

/**
 * Locate .claude/commands directory starting from startDir and walking upwards.
 */
export function findProjectClaudeCommandsDir(startDir: string = process.cwd()): string | null {
    let current = resolve(startDir);
    while (true) {
        try {
            const candidate = join(current, '.claude', 'commands');
            if (existsSync(candidate)) {
                return candidate;
            }
        } catch {
            break;
        }
        const parent = dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }
    return null;
}

interface ParsedFrontmatter {
    frontmatter: Record<string, unknown>;
    body: string;
}

/**
 * Parse markdown frontmatter delimited by `---` lines.
 */
function parseMarkdownFrontmatter(rawContent: string): ParsedFrontmatter {
    const trimmed = rawContent.trimStart();
    if (!trimmed.startsWith('---')) {
        return { frontmatter: {}, body: rawContent };
    }
    const match = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: rawContent };
    }
    try {
        const parsed = parse(match[1] ?? '');
        return {
            frontmatter: typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {},
            body: match[2] ?? '',
        };
    } catch {
        return { frontmatter: {}, body: rawContent };
    }
}

/** Options for scanning markdown command files from a directory. */
export interface ScanMarkdownOptions {
    prefix?: string;
    source?: string;
    defaultCategory?: SlashCommandCategory;
    pluginId?: string;
    tags?: string[];
}

/**
 * Scan a directory for markdown command files (*.md) and extract command candidates.
 */
export function scanMarkdownCommands(dirPath: string, options: ScanMarkdownOptions = {}): SlashCommandItem[] {
    if (!existsSync(dirPath)) {
        return [];
    }

    const { prefix = '/', source = 'plugin:sp', defaultCategory, pluginId } = options;
    const items: SlashCommandItem[] = [];

    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) {
                continue;
            }

            const fullPath = join(dirPath, entry.name);
            const stem = basename(entry.name, '.md');
            const fileContent = readFileSync(fullPath, 'utf-8');
            const { frontmatter, body } = parseMarkdownFrontmatter(fileContent);

            // Command name: prefix with e.g. '/sp:' or '/'
            const cleanPrefix = prefix.endsWith(':') ? prefix : prefix.endsWith('/') ? prefix : `${prefix}:`;
            const name = prefix === '/' ? `/${stem}` : `${cleanPrefix}${stem}`;

            // Description extraction
            let description = '';
            if (typeof frontmatter.description === 'string' && frontmatter.description.trim().length > 0) {
                description = frontmatter.description.trim();
            } else {
                // Look for first markdown header or first non-empty line
                const lines = body
                    .split('\n')
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0);
                const firstHeading = lines.find((l) => l.startsWith('# '));
                const firstLine = lines[0];
                if (firstHeading) {
                    description = firstHeading.replace(/^#\s+/, '').trim();
                } else if (firstLine !== undefined) {
                    description = firstLine.replace(/^[#*-\s]+/, '').trim();
                } else {
                    description = stem.replace(/[-_]/g, ' ');
                }
            }

            // Category deduction
            let category: SlashCommandCategory;
            const fmCategory = typeof frontmatter.category === 'string' ? frontmatter.category.toLowerCase() : '';
            if (fmCategory === 'git' || fmCategory === 'dev' || fmCategory === 'sys' || fmCategory === 'harness') {
                category = fmCategory;
            } else {
                category = defaultCategory ?? deduceCommandCategory(stem);
            }

            // Argument hint
            const hintRaw =
                frontmatter['argument-hint'] ?? frontmatter.argumentHint ?? frontmatter.arguments ?? frontmatter.args;
            const argumentHint = typeof hintRaw === 'string' && hintRaw.trim().length > 0 ? hintRaw.trim() : undefined;

            // Role
            const roleRaw = frontmatter.role;
            const role = typeof roleRaw === 'string' && roleRaw.trim().length > 0 ? roleRaw.trim() : undefined;

            // Tags extraction & derivation
            const rawTags = frontmatter.tags ?? frontmatter.tag;
            const tagSet = new Set<string>();

            // 1. Explicit tags from frontmatter (array or comma-delimited string)
            if (Array.isArray(rawTags)) {
                for (const t of rawTags) {
                    if (typeof t === 'string' && t.trim().length > 0) {
                        tagSet.add(t.trim().toLowerCase());
                    }
                }
            } else if (typeof rawTags === 'string' && rawTags.trim().length > 0) {
                for (const t of rawTags.split(',')) {
                    if (t.trim().length > 0) {
                        tagSet.add(t.trim().toLowerCase());
                    }
                }
            }

            // 2. Extra tags passed via options
            if (Array.isArray(options.tags)) {
                for (const t of options.tags) {
                    if (t.trim().length > 0) {
                        tagSet.add(t.trim().toLowerCase());
                    }
                }
            }

            // 3. Category tag
            if (category) {
                tagSet.add(category);
            }

            // 4. Plugin identifier / prefix tag (e.g. 'sp', 'cc', 'kk', 'wt')
            if (pluginId) {
                tagSet.add(pluginId.toLowerCase());
            } else if (prefix && prefix !== '/') {
                const clean = prefix.replace(/^[/:]+|[/:]+$/g, '').toLowerCase();
                if (clean.length > 0) {
                    tagSet.add(clean);
                }
            }

            // 5. Inferred words from stem (e.g. 'dev-plan' -> 'dev', 'plan')
            for (const part of stem.split(/[-_]/)) {
                const p = part.trim().toLowerCase();
                if (p.length > 1 && !tagSet.has(p)) {
                    tagSet.add(p);
                }
            }

            const tags = Array.from(tagSet);

            items.push({
                name,
                description,
                category,
                argumentHint,
                tags,
                role,
                source,
            });
        }
    } catch {
        // Tolerant on directory read errors
    }

    return items;
}

/** Information about a discovered Claude Code plugin. */
export interface DiscoveredPlugin {
    id: string;
    name: string;
    marketplace?: string;
    installPath?: string;
    commandsDir?: string;
}

/** Options for discovering installed and enabled Claude Code plugins. */
export interface DiscoverPluginsOptions {
    projectRoot?: string;
    claudeDir?: string;
}

/**
 * Discover all installed and enabled Claude Code plugins across the user's system and project.
 */
export function discoverEnabledClaudePlugins(options: DiscoverPluginsOptions = {}): DiscoveredPlugin[] {
    const { projectRoot = process.cwd(), claudeDir = join(homedir(), '.claude') } = options;

    const userSettingsPath = join(claudeDir, 'settings.json');
    const projectSettingsPath = join(projectRoot, '.claude', 'settings.json');
    const installedPath = join(claudeDir, 'plugins', 'installed_plugins.json');

    let userSettings: Record<string, unknown> = {};
    if (existsSync(userSettingsPath)) {
        try {
            userSettings = JSON.parse(readFileSync(userSettingsPath, 'utf-8'));
        } catch {
            // Tolerant
        }
    }

    let projectSettings: Record<string, unknown> = {};
    if (existsSync(projectSettingsPath)) {
        try {
            projectSettings = JSON.parse(readFileSync(projectSettingsPath, 'utf-8'));
        } catch {
            // Tolerant
        }
    }

    const enabledPlugins: Record<string, boolean> = {
        ...((userSettings.enabledPlugins as Record<string, boolean> | undefined) ?? {}),
        ...((projectSettings.enabledPlugins as Record<string, boolean> | undefined) ?? {}),
    };

    const extraKnownMarketplaces: Record<string, { source?: { source?: string; path?: string } }> = {
        ...((userSettings.extraKnownMarketplaces as
            | Record<string, { source?: { source?: string; path?: string } }>
            | undefined) ?? {}),
        ...((projectSettings.extraKnownMarketplaces as
            | Record<string, { source?: { source?: string; path?: string } }>
            | undefined) ?? {}),
    };

    let installedManifest: { plugins?: Record<string, Array<{ installPath?: string }>> } = { plugins: {} };
    if (existsSync(installedPath)) {
        try {
            installedManifest = JSON.parse(readFileSync(installedPath, 'utf-8'));
        } catch {
            // Tolerant
        }
    }

    const installedPlugins = installedManifest.plugins ?? {};

    const candidateKeys = new Set<string>();
    for (const [key, isEnabled] of Object.entries(enabledPlugins)) {
        if (isEnabled) {
            candidateKeys.add(key);
        }
    }
    if (candidateKeys.size === 0) {
        for (const key of Object.keys(installedPlugins)) {
            if (enabledPlugins[key] !== false) {
                candidateKeys.add(key);
            }
        }
    }

    const results: DiscoveredPlugin[] = [];

    for (const pluginKey of candidateKeys) {
        if (enabledPlugins[pluginKey] === false) {
            continue;
        }

        const atIndex = pluginKey.indexOf('@');
        const pluginName = atIndex !== -1 ? pluginKey.slice(0, atIndex) : pluginKey;
        const marketplaceName = atIndex !== -1 ? pluginKey.slice(atIndex + 1) : undefined;

        let resolvedDir: string | null = null;

        // 1. Check installPath in installed_plugins.json
        const installs = installedPlugins[pluginKey];
        if (Array.isArray(installs)) {
            for (const inst of installs) {
                if (typeof inst.installPath === 'string' && existsSync(inst.installPath)) {
                    resolvedDir = inst.installPath;
                    break;
                }
            }
        }

        // 2. Check extraKnownMarketplaces directory source
        if (!resolvedDir && marketplaceName && extraKnownMarketplaces[marketplaceName]) {
            const mSrc = extraKnownMarketplaces[marketplaceName]?.source;
            if (mSrc?.source === 'directory' && typeof mSrc.path === 'string') {
                const cand1 = join(mSrc.path, 'plugins', pluginName);
                const cand2 = join(mSrc.path, pluginName);
                if (existsSync(cand1)) {
                    resolvedDir = cand1;
                } else if (existsSync(cand2)) {
                    resolvedDir = cand2;
                }
            }
        }

        // 3. Check cache: ~/.claude/plugins/cache/<marketplace>/<plugin>
        if (!resolvedDir && marketplaceName) {
            const cacheDir = join(claudeDir, 'plugins', 'cache', marketplaceName, pluginName);
            if (existsSync(cacheDir)) {
                try {
                    const entries = readdirSync(cacheDir, { withFileTypes: true });
                    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
                    const lastDir = dirs[dirs.length - 1];
                    if (lastDir) {
                        resolvedDir = join(cacheDir, lastDir);
                    }
                } catch {
                    // Tolerant
                }
            }
        }

        // 4. Check ~/.claude/plugins/marketplaces/<marketplace>/plugins/<plugin>
        if (!resolvedDir && marketplaceName) {
            const mpDir = join(claudeDir, 'plugins', 'marketplaces', marketplaceName, 'plugins', pluginName);
            if (existsSync(mpDir)) {
                resolvedDir = mpDir;
            }
        }

        // 5. Local project fallback (e.g. plugins/sp in spur-new)
        if (!resolvedDir) {
            const localPlugin = resolve(projectRoot, 'plugins', pluginName);
            if (existsSync(localPlugin)) {
                resolvedDir = localPlugin;
            }
        }

        let commandsDir: string | undefined;
        if (resolvedDir) {
            const candidateCommands = join(resolvedDir, 'commands');
            if (existsSync(candidateCommands)) {
                commandsDir = candidateCommands;
            }
        }

        results.push({
            id: pluginKey,
            name: pluginName,
            marketplace: marketplaceName,
            installPath: resolvedDir ?? undefined,
            commandsDir,
        });
    }

    return results;
}

/** Options for generating the aggregate slash commands list. */
export interface GenerateSlashCommandsOptions {
    projectRoot?: string;
    includeBuiltin?: boolean;
    includePluginSp?: boolean;
    includeAllPlugins?: boolean;
    includeProjectClaude?: boolean;
    includeUserClaude?: boolean;
    includeUserSpur?: boolean;
    claudeDir?: string;
}

/**
 * Generate a complete, deduplicated array of slash command items based on what
 * Claude Code and Spur have configured right now.
 */
export function generateSlashCommands(options: GenerateSlashCommandsOptions = {}): SlashCommandItem[] {
    const {
        projectRoot = process.cwd(),
        includeBuiltin = true,
        includePluginSp = true,
        includeAllPlugins = true,
        includeProjectClaude = true,
        includeUserClaude = true,
        includeUserSpur = true,
        claudeDir,
    } = options;

    const commandMap = new Map<string, SlashCommandItem>();

    // 1. Built-in Claude Code commands
    if (includeBuiltin) {
        for (const cmd of getBuiltinClaudeCommands()) {
            commandMap.set(cmd.name, cmd);
        }
    }

    // 2. All enabled Claude Code plugins (cc, kk, wt, sp, etc.)
    if (includeAllPlugins) {
        const plugins = discoverEnabledClaudePlugins({ projectRoot, claudeDir });
        for (const plugin of plugins) {
            if (plugin.commandsDir) {
                const pluginCommands = scanMarkdownCommands(plugin.commandsDir, {
                    prefix: `/${plugin.name}:`,
                    source: `plugin:${plugin.name}`,
                    pluginId: plugin.name,
                    defaultCategory: deduceCommandCategory(plugin.name),
                });
                for (const cmd of pluginCommands) {
                    commandMap.set(cmd.name, cmd);
                }
            }
        }
    }

    // 3. Monorepo plugin commands (plugins/sp/commands/*.md) - override/merge local sp
    if (includePluginSp) {
        const spCommandsDir =
            findPluginsSpCommandsDir(projectRoot) ?? resolve(projectRoot, 'plugins', 'sp', 'commands');
        if (existsSync(spCommandsDir)) {
            const spCommands = scanMarkdownCommands(spCommandsDir, {
                prefix: '/sp:',
                source: 'plugin:sp',
                pluginId: 'sp',
                defaultCategory: 'harness',
            });
            for (const cmd of spCommands) {
                commandMap.set(cmd.name, cmd);
            }
        }
    }

    // 4. Project-level Claude commands (.claude/commands/*.md)
    if (includeProjectClaude) {
        const projectClaudeDir =
            findProjectClaudeCommandsDir(projectRoot) ?? resolve(projectRoot, '.claude', 'commands');
        const projectCommands = scanMarkdownCommands(projectClaudeDir, {
            prefix: '/',
            source: 'claude:project',
        });
        for (const cmd of projectCommands) {
            commandMap.set(cmd.name, cmd);
        }
    }

    // 5. User-level Claude commands (~/.claude/commands/*.md)
    if (includeUserClaude) {
        const userClaudeDir = join(homedir(), '.claude', 'commands');
        const userClaudeCommands = scanMarkdownCommands(userClaudeDir, {
            prefix: '/',
            source: 'claude:user',
        });
        for (const cmd of userClaudeCommands) {
            commandMap.set(cmd.name, cmd);
        }
    }

    // 6. User-level Spur commands (~/.config/spur/commands/*.md)
    if (includeUserSpur) {
        const userSpurDir = join(homedir(), '.config', 'spur', 'commands');
        const userSpurCommands = scanMarkdownCommands(userSpurDir, {
            prefix: '/sp:',
            source: 'spur:user',
            pluginId: 'sp',
            defaultCategory: 'harness',
        });
        for (const cmd of userSpurCommands) {
            commandMap.set(cmd.name, cmd);
        }
    }

    return Array.from(commandMap.values());
}

/** Result of generating and saving the slash commands file. */
export interface GenerateSlashCommandsFileResult {
    path: string;
    count: number;
    commands: SlashCommandItem[];
}

/**
 * Generate slash command candidates and persist them to ~/.config/spur/slash_commands.json.
 */
export function generateSlashCommandsFile(
    targetPath: string = getSlashCommandsFilePath(),
    options: GenerateSlashCommandsOptions = {},
): GenerateSlashCommandsFileResult {
    const commands = generateSlashCommands(options);
    const filePayload: SlashCommandsFile = {
        version: 1,
        updatedAt: new Date().toISOString(),
        commands,
    };

    try {
        const dir = dirname(targetPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(targetPath, JSON.stringify(filePayload, null, 2), 'utf-8');
    } catch {
        // Tolerant if destination filesystem or directory permissions do not permit writing
    }

    return {
        path: targetPath,
        count: commands.length,
        commands,
    };
}

/**
 * Load slash commands from file. If the file does not exist, automatically generates
 * it from currently available Claude Code & Spur commands.
 */
export function loadSlashCommands(
    filePath: string = getSlashCommandsFilePath(),
    autoGenerateIfMissing = true,
    options: GenerateSlashCommandsOptions = {},
): SlashCommandItem[] {
    if (!existsSync(filePath)) {
        if (autoGenerateIfMissing) {
            const generated = generateSlashCommandsFile(filePath, options);
            return generated.commands;
        }
        return getBuiltinClaudeCommands();
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const raw = JSON.parse(content);
        const parsed = slashCommandsFileSchema.safeParse(raw);
        if (parsed.success && parsed.data.commands.length > 0) {
            return parsed.data.commands;
        }
    } catch {
        // Fall through to auto-generate or builtin
    }

    if (autoGenerateIfMissing) {
        const generated = generateSlashCommandsFile(filePath, options);
        return generated.commands;
    }

    return getBuiltinClaudeCommands();
}

/**
 * Service managing slash command discovery, caching, generation, and file storage.
 */
export class SlashCommandsService {
    private readonly filePath: string;
    private readonly projectRoot: string;
    private cachedCommands: SlashCommandItem[] | null = null;

    constructor(options: { filePath?: string; projectRoot?: string } = {}) {
        this.filePath = options.filePath ?? getSlashCommandsFilePath();
        this.projectRoot = options.projectRoot ?? process.cwd();
    }

    getFilePath(): string {
        return this.filePath;
    }

    getCommands(forceReload = false): SlashCommandItem[] {
        if (!this.cachedCommands || forceReload) {
            this.cachedCommands = loadSlashCommands(this.filePath, true, {
                projectRoot: this.projectRoot,
            });
        }
        return this.cachedCommands;
    }

    generate(targetPath?: string): GenerateSlashCommandsFileResult {
        const dest = targetPath ?? this.filePath;
        const result = generateSlashCommandsFile(dest, {
            projectRoot: this.projectRoot,
        });
        this.cachedCommands = result.commands;
        return result;
    }
}
