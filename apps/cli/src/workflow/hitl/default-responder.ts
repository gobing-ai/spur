import type { HitlAnswer, HitlRequest, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';

/** Defaults for each request kind when running non-interactively. */
export interface DefaultHitlResponderConfig {
    /** confirm default: 'yes' | 'no' | 'cancel' (default 'yes'). */
    confirmDefault?: string;
    /** select default: index into options (default 0). */
    selectDefaultIndex?: number;
    /** input default: fallback string (default ''). */
    inputDefault?: string;
}

/**
 * Non-interactive responder that returns configured defaults without prompting.
 * Used for CI, `--json`, and headless execution.
 */
export class DefaultHitlResponder implements HitlResponder {
    private readonly config: Required<DefaultHitlResponderConfig>;

    constructor(config: DefaultHitlResponderConfig = {}) {
        this.config = {
            confirmDefault: config.confirmDefault ?? 'yes',
            selectDefaultIndex: config.selectDefaultIndex ?? 0,
            inputDefault: config.inputDefault ?? '',
        };
    }

    async respond(request: HitlRequest): Promise<HitlAnswer> {
        switch (request.kind) {
            case 'confirm':
                return { value: this.config.confirmDefault };
            case 'select': {
                const options = request.options ?? [];
                const idx = Math.max(0, Math.min(this.config.selectDefaultIndex, options.length - 1));
                return { value: options[idx] ?? '' };
            }
            case 'input':
                return { value: this.config.inputDefault };
        }
    }
}
