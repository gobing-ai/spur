import { resolve, sep } from 'node:path';
import type { ServerContext } from '../../context';
import { InvalidArgumentsError, type McpToolAnnotations, type McpToolDescriptor } from './protocol';

/**
 * The plumbing every built-in tool domain shares (task 1445 R7 split): the frozen annotation
 * pair, the argument readers the schema-checked dispatcher uses, and the write/error shims.
 */

/**
 * Frozen annotation pair (1421 R2): reads are idempotent, writes are neither read-only nor
 * idempotent (create, transition and workflow_run are not), and no Spur tool deletes.
 */
export const READ_TOOL: McpToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
/** The mutating half of the pair: a tool that can write must never advertise as read-only. */
export const WRITE_TOOL: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

/**
 * One tool handler: the injected context plus the schema-validated arguments. The protocol
 * serializes whatever the handler returns, so the value is not a closed union.
 */
export type ToolHandler = (ctx: ServerContext, args: Record<string, unknown>) => Promise<unknown>;

/**
 * The JSON-Schema subset the descriptors use: `required`, `type`, `enum`, `additionalProperties`.
 * Returns a message naming the offending argument (mapped to `invalid_arguments` by the emit site).
 */
export function validateToolArguments(tool: McpToolDescriptor, args: Record<string, unknown>): string | null {
    const schema = (tool.inputSchema ?? {}) as {
        properties?: Record<string, unknown>;
        required?: unknown;
        additionalProperties?: unknown;
    };
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = Array.isArray(schema.required)
        ? schema.required.filter((key): key is string => typeof key === 'string')
        : [];
    for (const key of required) {
        if (args[key] === undefined) return `${key} is required`;
    }
    if (schema.additionalProperties === false) {
        for (const key of Object.keys(args)) {
            if (args[key] === undefined) continue;
            if (!(key in properties)) {
                const accepted = Object.keys(properties);
                return accepted.length > 0
                    ? `unknown argument "${key}"; accepted: ${accepted.join(', ')}`
                    : `unknown argument "${key}"`;
            }
        }
    }
    for (const [key, value] of Object.entries(args)) {
        if (value === undefined) continue;
        const spec = properties[key];
        if (typeof spec !== 'object' || spec === null) continue;
        const rules = spec as { enum?: unknown; type?: unknown };
        if (Array.isArray(rules.enum) && !rules.enum.includes(value)) {
            return `${key} must be one of ${rules.enum.join(', ')}`;
        }
        const expected = typeof rules.type === 'string' ? rules.type : undefined;
        if (expected === 'string' && typeof value !== 'string') return `${key} must be a string`;
        if (expected === 'boolean' && typeof value !== 'boolean') return `${key} must be a boolean`;
        if (expected === 'array' && !Array.isArray(value)) return `${key} must be an array`;
    }
    return null;
}

/**
 * Keep a service error's machine code on the way out (1392 R4): `GuardDeniedError` and the write
 * services carry `code`, and an MCP caller must see the same `CODE: message` the CLI reports.
 */
export function withServiceCode(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    // The services signal a refusal through the error CLASS (`GuardDeniedError`), not a `code`
    // field, so the class name is the machine code the CLI's JSON also reports.
    const name = error instanceof Error ? error.name : '';
    if (name === 'GuardDeniedError') return new Error(`GUARD_DENIED: ${message}`);
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' && code !== '' ? new Error(`${code}: ${message}`) : new Error(message);
}

/** A string list from an already-schema-validated argument; absent stays undefined. */
export function stringArray(args: Record<string, unknown>, key: string): string[] | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new InvalidArgumentsError(`${key} must be an array of strings`);
    return value.map((entry) => {
        if (typeof entry !== 'string') throw new InvalidArgumentsError(`${key} must be an array of strings`);
        return entry;
    });
}

/** The small, stable part of a write result an MCP caller needs (never the whole service object). */
export function summarizeWrite(result: { eventName?: string; warnings?: string[] }): Record<string, unknown> {
    return {
        eventName: result.eventName ?? null,
        warnings: result.warnings ?? [],
    };
}

/** `runId`/`wbs` when the call's arguments or its result already carry them (1376 R2). */
export function correlation(args: Record<string, unknown>, result: unknown): { runId?: string; wbs?: string } {
    const from = (source: unknown, key: 'runId' | 'wbs'): string | undefined => {
        if (typeof source !== 'object' || source === null) return undefined;
        const value = (source as Record<string, unknown>)[key];
        return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const runId = from(args, 'runId') ?? from(result, 'runId');
    const wbs = from(args, 'wbs') ?? from(result, 'wbs');
    return { ...(runId === undefined ? {} : { runId }), ...(wbs === undefined ? {} : { wbs }) };
}

/** The three catalog error codes, derived at the emit site from the dispatcher's own throws (1376 R2). */
export function toolErrorCode(error: unknown): 'unknown_tool' | 'invalid_arguments' | 'tool_error' {
    // 1421 R1: argument validation is a CLASS, not a message shape — every validator site throws
    // `InvalidArgumentsError`, so a new message can never be misfiled as a service failure.
    if (error instanceof InvalidArgumentsError) return 'invalid_arguments';
    const message = error instanceof Error ? error.message : String(error);
    // A legacy name that 1379/1380 renamed is not a tool failure — the client sent a name this
    // surface no longer accepts, which is the same signal as an unknown one.
    if (message.startsWith('unknown tool') || message.includes('was renamed to')) return 'unknown_tool';
    return 'tool_error';
}

/** A rule file argument stays inside the project root: no arbitrary path is read from disk. */
export function projectFile(cwd: string, value: string): string {
    const root = resolve(cwd);
    const file = resolve(root, value);
    if (file !== root && !file.startsWith(`${root}${sep}`)) {
        throw new InvalidArgumentsError(`file must be inside the project (${root}): ${value}`);
    }
    return file;
}

/** An arbitrary inline JSON map from an already-schema-validated argument (decision params). */
export function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InvalidArgumentsError(`${key} must be an object`);
    }
    return value as Record<string, unknown>;
}

/** A required non-empty string argument; absent reads as `invalid_arguments`, not a service failure. */
export function requiredString(args: Record<string, unknown>, key: string): string {
    const value = optionalString(args, key);
    if (value === undefined) throw new InvalidArgumentsError(`${key} is required`);
    return value;
}

/** A trimmed non-empty string argument, or undefined — blank and non-string values both read as absent. */
export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
    const value = args[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A `Record<string, string>` argument (workflow vars); a non-object or non-string entry is refused. */
export function stringRecord(args: Record<string, unknown>, key: string): Record<string, string> | undefined {
    const value = args[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new InvalidArgumentsError(`${key} must be a map of strings`);
    }
    const record: Record<string, string> = {};
    for (const [name, entry] of Object.entries(value)) {
        if (typeof entry !== 'string') throw new InvalidArgumentsError(`${key} must be a map of strings`);
        record[name] = entry;
    }
    return record;
}

/**
 * Inline section body → scoped temp file → the service's section writer (which reads a source
 * file, the way the CLI's `--section --from-file` works). The temp file is removed either way.
 */
export async function writeInlineSection<T>(
    section: string,
    content: string,
    write: (sourceFile: string) => Promise<T>,
): Promise<T> {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'spur-mcp-section-'));
    const sourceFile = join(dir, `${section}.md`);
    try {
        writeFileSync(sourceFile, content);
        return await write(sourceFile);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
