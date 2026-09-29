/**
 * Throwing contribution entry (task 0988 R4).
 *
 * The component throws during render. The browser proof renders it inside the Board tree under a
 * containment boundary and asserts the failure is contained: the board's built-in modules remain
 * registered, navigable and rendered.
 */
export const THROW_MESSAGE = 'downstream contribution failed to render';

export function ThrowingContribution(): never {
    throw new Error(THROW_MESSAGE);
}

export const webModule = {
    apiVersion: 1,
    component: ThrowingContribution,
} as const;
