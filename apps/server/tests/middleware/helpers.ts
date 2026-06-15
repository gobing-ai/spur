import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';

export function mockRuntime(logCalls?: { msg: string; data?: Record<string, unknown> }[]): ApplicationRuntime {
    return {
        config: {} as unknown as ApplicationRuntime['config'],
        appConfig: undefined,
        logger: {
            info: (msg: string, data?: Record<string, unknown>) => logCalls?.push({ msg, data }),
            warn: () => {},
            error: () => {},
            debug: () => {},
            trace: () => {},
            fatal: () => {},
            child: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
                trace: () => {},
                fatal: () => {},
                child: () => ({}) as never,
            }),
        },
        events: { emit: () => {}, on: () => {}, off: () => {} },
        db: undefined,
        pluginHost: {} as unknown,
        stop: async () => {},
    } as unknown as ApplicationRuntime;
}
