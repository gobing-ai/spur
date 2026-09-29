// Failing native module for the composed-path browser proof (task 0992 R3, AC1).
//
// A valid descriptor whose component throws on render: the Board composes it like any other
// module, mounts it on its own route and only the ModuleErrorBoundary contains the failure.

/** Message the boundary must surface for this module. */
export const THROW_MESSAGE = 'composed probe failed to render';

/** Component that throws during render. */
export function ThrowingContribution() {
    throw new Error(THROW_MESSAGE);
}

/** Valid contribution shape — the failure is at render time, not at load/validation time. */
export const webModule = {
    apiVersion: 1,
    component: ThrowingContribution,
};
