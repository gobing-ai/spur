import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';

const noop = (): void => {};
const noopAsync = async (): Promise<void> => {};
export const noopChild = (): Record<string, () => void> => ({
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: noopChild as never,
});

export function mockRuntime(logCalls?: { msg: string; data?: Record<string, unknown> }[]): ApplicationRuntime {
    return {
        config: {} as unknown as ApplicationRuntime['config'],
        appConfig: undefined,
        logger: {
            info: (msg: string, data?: Record<string, unknown>) => logCalls?.push({ msg, data }),
            warn: noop,
            error: noop,
            debug: noop,
            trace: noop,
            fatal: noop,
            child: () => noopChild(),
        },
        events: { emit: noop, on: noop, off: noop },
        db: undefined,
        pluginHost: {} as unknown,
        stop: noopAsync as unknown as ApplicationRuntime['stop'],
    } as unknown as ApplicationRuntime;
}
