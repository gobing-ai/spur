/**
 * Re-export of the app-owned Git read (A93 1352): the collector moved to
 * `@gobing-ai/spur-app` so `self status` can build its aggregate in one service, and the
 * CLI keeps this path for `dispatch-inspect` and its own tests.
 */
export { type GitContext, gitContext } from '@gobing-ai/spur-app';
