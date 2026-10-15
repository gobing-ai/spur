/** `@gobing-ai/spur-config/env` — the light env subpath is the same funnel as the package root. */

import { expect, test } from 'bun:test';
import * as env from '../src/env';
import * as root from '../src/index';

test('the env subpath re-exports exactly the root gateway functions', () => {
    expect(Object.keys(env).sort()).toEqual(['getAppOptions', 'getEnvVar', 'getEnvVars', 'removeEnvVar', 'setEnvVar']);
    expect(root.getAppOptions).toBe(env.getAppOptions);
    expect(root.getEnvVar).toBe(env.getEnvVar);
    expect(root.getEnvVars).toBe(env.getEnvVars);
    expect(root.removeEnvVar).toBe(env.removeEnvVar);
    expect(root.setEnvVar).toBe(env.setEnvVar);
});

test('reads and writes go through the live environment', () => {
    env.setEnvVar('SPUR_ENV_SUBPATH_PROBE', 'on');
    expect(env.getEnvVar('SPUR_ENV_SUBPATH_PROBE')).toBe('on');
    expect(env.getEnvVars().SPUR_ENV_SUBPATH_PROBE).toBe('on');
    env.removeEnvVar('SPUR_ENV_SUBPATH_PROBE');
    expect(env.getEnvVar('SPUR_ENV_SUBPATH_PROBE')).toBeUndefined();
});
