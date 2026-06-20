import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';

const noop = (): void => {};
const noopAsync = async (): Promise<void> => {};
export const noopChild = (): Record<string, () => void> =>
    ({
        info: noop,
        warn: noop,
        error: noop,
        debug: noop,
        trace: noop,
        fatal: noop,
        child: noopChild,
    }) as unknown as Record<string, () => void>;

export function mockRuntime(logCalls?: { msg: string; data?: Record<string, unknown> }[]): ApplicationRuntime {
    const capture = (level: string) => (msg: string, data?: Record<string, unknown>) =>
        logCalls?.push({ msg, data: { ...data, _level: level } });
    return {
        config: {} as unknown as ApplicationRuntime['config'],
        appConfig: undefined,
        logger: {
            info: capture('info'),
            warn: capture('warn'),
            error: capture('error'),
            debug: capture('debug'),
            trace: noop,
            fatal: capture('fatal'),
            child: () => noopChild(),
        },
        events: { emit: noop, on: noop, off: noop } as unknown as ApplicationRuntime['events'],
        db: undefined,
        pluginHost: {} as unknown,
        stop: noopAsync as unknown as ApplicationRuntime['stop'],
    } as unknown as ApplicationRuntime;
}
