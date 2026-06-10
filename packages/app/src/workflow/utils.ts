import type { Colorize } from '../services/rule-service';

const identity = (s: string): string => s;

/** Null-object Colorize that returns every string unchanged (color disabled). */
export const NO_COLOR: Colorize = {
    enabled: false,
    dim: identity,
    red: identity,
    green: identity,
    yellow: identity,
    cyan: identity,
};
