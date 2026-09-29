import * as React from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

/**
 * The fixture's OWN React instance (task 0988 R4 negative control).
 *
 * This module is built without externals, so these bindings come from the consumer's own
 * `node_modules/react` — a genuinely separate installation from the Board's. The browser proof
 * asserts `useState` etc. are NOT the same function objects as the host's while the `version`
 * string still matches: version equality alone would be a false positive.
 */
export const ownReact = {
    version: React.version,
    useState: React.useState,
    createElement: React.createElement,
    createContext: React.createContext,
    jsx,
    jsxs,
    Fragment,
} as const;
