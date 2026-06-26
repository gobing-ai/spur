/**
 * Binary-embedded Spur JSON schemas for the CLI's config loaders.
 *
 * The `@gobing-ai/spur-config/loader` facade validates a config file's
 * `$schema: "@gobing-ai/spur/schemas/<name>.schema.json"` declaration via ts-runtime.
 * That reference cannot be resolved from `node_modules` inside a `bun build --compile`
 * standalone binary (there is no `node_modules` at runtime), and a bare package
 * specifier is not a real filesystem path even in a dev tree — so the loader must be
 * handed the schema text up front.
 *
 * These JSON schemas are **statically imported** so Bun embeds them into the compiled
 * binary, then registered here keyed by their subpath under the package root. Every CLI
 * call into `loadSpurConfig` / `loadStructuredSpurConfig` passes this map so any Spur
 * config validates identically in dev and in a `--compile` binary. Add every schema Spur
 * owns and ships here.
 */
import sectionMatrixSchema from '../../schemas/section-matrix.schema.json';
import spurConfigSchema from '../../schemas/spur-config.schema.json';

/** Embedded Spur schemas keyed by `schemas/<name>.schema.json` subpath. */
export const EMBEDDED_SPUR_SCHEMAS: ReadonlyMap<string, string> = new Map<string, string>([
    ['schemas/spur-config.schema.json', JSON.stringify(spurConfigSchema)],
    ['schemas/section-matrix.schema.json', JSON.stringify(sectionMatrixSchema)],
]);
