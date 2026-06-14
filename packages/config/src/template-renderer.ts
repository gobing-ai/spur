/**
 * Simple `{{ PLACEHOLDER }}` string substitution — no template engine dependency.
 *
 * Placeholders use double-curly syntax: `{{ NAME }}`, `{{ CREATED_AT }}`.
 * Whitespace around the placeholder name inside the braces is stripped.
 * Unmatched placeholders are left in the output — they are data, not errors.
 */

const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

/**
 * Replace `{{ KEY }}` placeholders in `template` with values from `vars`.
 * Keys in `vars` are case-sensitive. Placeholder names are matched as `\w+`.
 *
 * @returns The rendered string with matched placeholders replaced.
 */
export function renderTemplate(template: string, vars: Record<string, string>): string {
    return template.replace(PLACEHOLDER_RE, (match: string, name: string) =>
        Object.hasOwn(vars, name) ? (vars[name] ?? match) : match,
    );
}
