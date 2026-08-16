/**
 * task-file-policy — the cheap local answer to "could this path possibly be a
 * task file?", shared by every platform's write guard.
 *
 * **Why this exists.** The write guards decide ownership by shelling
 * `spur task resolve --strict --json`, which costs a full CLI start — measured
 * 119-122ms with an installed binary, 187-238ms source-local — on *every* `Write`
 * and `Edit` tool call, the overwhelming majority of which target ordinary source
 * files that could never be task files. This predicate skips the subprocess for
 * those without weakening the guard.
 *
 * **Why it cannot produce a false allow.** `--strict` resolution matches a corpus
 * file through `TASK_FILENAME_RE` in `packages/app/src/services/task-locator.ts`
 * (`^(\d{4})_(.+)\.md$`), so a basename failing that pattern can never be reported
 * owned. This predicate is the same test, applied locally. If the corpus filename
 * convention ever changes, this must change with it — `task-file-policy.test.ts`
 * pins the two together.
 */

/** The corpus task filename convention: `<4-digit wbs>_<slug>.md`. */
const TASK_FILENAME_RE = /^(\d{4})_(.+)\.md$/;

/**
 * True when `filePath`'s basename could name a task file. A `false` result is
 * authoritative — no `spur task resolve --strict` call is needed. A `true` result
 * only means "ask the CLI"; folder membership is still the CLI's decision.
 */
export function couldBeTaskFile(filePath: string): boolean {
    const basename = filePath.split(/[\\/]/).pop() ?? '';
    return TASK_FILENAME_RE.test(basename);
}
