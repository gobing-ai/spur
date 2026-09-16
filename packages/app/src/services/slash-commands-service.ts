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
        source: 'builtin',
    },
    {
        name: '/clear',
        description: 'Clear conversation history and reset context window',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/compact',
        description: 'Purge execution trace and condense context window',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/cost',
        description: 'Inspect token breakdown and USD expenditure',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/doctor',
        description: 'Run diagnostic health checks on environment and tools',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/init',
        description: 'Initialize project instructions, settings and guidelines',
        category: 'harness',
        source: 'builtin',
    },
    {
        name: '/review',
        description: 'Inspect staged git diff, verify test coverage & lint',
        category: 'git',
        source: 'builtin',
    },
    {
        name: '/commit',
        description: 'Draft conventional commit message from staged hunks',
        category: 'git',
        source: 'builtin',
    },
    {
        name: '/terminal',
        description: 'Run isolated bash execution in sandbox mirror',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/revert',
        description: 'Undo last agent file changes or restore git stash',
        category: 'git',
        source: 'builtin',
    },
    {
        name: '/resume',
        description: 'Resume paused background agent run',
        category: 'dev',
        source: 'builtin',
    },
    {
        name: '/bug',
        description: 'Report a bug or issue with diagnostic transcript',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/config',
        description: 'View or update local/global configuration settings',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/login',
        description: 'Authenticate account and refresh API credentials',
        category: 'sys',
        source: 'builtin',
    },
    {
        name: '/logout',
        description: 'Sign out of current account and remove stored session',
        category: 'sys',
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
}

/**
 * Scan a directory for markdown command files (*.md) and extract command candidates.
 */
export function scanMarkdownCommands(dirPath: string, options: ScanMarkdownOptions = {}): SlashCommandItem[] {
    if (!existsSync(dirPath)) {
        return [];
    }

    const { prefix = '/', source = 'plugin:sp', defaultCategory } = options;
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
            const hintRaw = frontmatter['argument-hint'] ?? frontmatter.argumentHint;
            const argumentHint = typeof hintRaw === 'string' && hintRaw.trim().length > 0 ? hintRaw.trim() : undefined;

            // Role
            const roleRaw = frontmatter.role;
            const role = typeof roleRaw === 'string' && roleRaw.trim().length > 0 ? roleRaw.trim() : undefined;

            items.push({
                name,
                description,
                category,
                argumentHint,
                role,
                source,
            });
        }
    } catch {
        // Tolerant on directory read errors
    }

    return items;
}

/** Options for generating the aggregate slash commands list. */
export interface GenerateSlashCommandsOptions {
    projectRoot?: string;
    includeBuiltin?: boolean;
    includePluginSp?: boolean;
    includeProjectClaude?: boolean;
    includeUserClaude?: boolean;
    includeUserSpur?: boolean;
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
        includeProjectClaude = true,
        includeUserClaude = true,
        includeUserSpur = true,
    } = options;

    const commandMap = new Map<string, SlashCommandItem>();

    // 1. Built-in Claude Code commands
    if (includeBuiltin) {
        for (const cmd of getBuiltinClaudeCommands()) {
            commandMap.set(cmd.name, cmd);
        }
    }

    // 2. Monorepo plugin commands (plugins/sp/commands/*.md)
    if (includePluginSp) {
        const spCommandsDir =
            findPluginsSpCommandsDir(projectRoot) ?? resolve(projectRoot, 'plugins', 'sp', 'commands');
        const spCommands = scanMarkdownCommands(spCommandsDir, {
            prefix: '/sp:',
            source: 'plugin:sp',
            defaultCategory: 'harness',
        });
        for (const cmd of spCommands) {
            commandMap.set(cmd.name, cmd);
        }
    }

    // 3. Project-level Claude commands (.claude/commands/*.md)
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

    // 4. User-level Claude commands (~/.claude/commands/*.md)
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

    // 5. User-level Spur commands (~/.config/spur/commands/*.md)
    if (includeUserSpur) {
        const userSpurDir = join(homedir(), '.config', 'spur', 'commands');
        const userSpurCommands = scanMarkdownCommands(userSpurDir, {
            prefix: '/sp:',
            source: 'spur:user',
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
