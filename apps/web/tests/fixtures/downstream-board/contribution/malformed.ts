/**
 * Malformed contribution entry (task 0988 R4).
 *
 * A published-looking entry that exports `webModule` with no component. The browser proof loads it
 * from the fixed test asset path and asserts the invalid shape is rejected while the built-in
 * modules stay registered and navigable.
 */
export const webModule = {
    apiVersion: 1,
} as const;
