/**
 * Shell-quoting helper shared by the light gate (`quality-gate.ts`) and the SDLC action
 * resolver (`sdlc-actions.ts`), so a substituted path is quoted one way everywhere.
 */

/**
 * Quote one argument for `sh -c`. Changed-file names come from the working tree (untracked files
 * included), so an unquoted `x$(cmd).ts` would run `cmd` and a space would split the argument.
 * Plain paths pass through unchanged to keep receipts readable.
 */
export function shQuote(arg: string): string {
    return /^[\w./@+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
