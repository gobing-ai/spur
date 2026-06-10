import * as p from '@clack/prompts';
import type { HitlAnswer, HitlRequest, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Interactive CLI responder using @clack/prompts.
 * Only instantiated when stdout is a TTY and not --json.
 */
export class ClackHitlResponder implements HitlResponder {
    constructor() {}

    async respond(request: HitlRequest): Promise<HitlAnswer> {
        switch (request.kind) {
            case 'confirm': {
                const result = await p.select<string>({
                    message: request.prompt,
                    options: [
                        { value: 'yes', label: 'Yes' },
                        { value: 'no', label: 'No' },
                        { value: 'cancel', label: 'Cancel' },
                    ],
                });

                if (p.isCancel(result)) {
                    return { value: 'cancel', cancelled: true };
                }
                return { value: result };
            }
            case 'select': {
                const options = (request.options ?? []).map((opt) => ({ value: opt, label: opt }));
                const result = await p.select<string>({
                    message: request.prompt,
                    options,
                });

                if (p.isCancel(result)) {
                    return { value: '', cancelled: true };
                }
                return { value: result };
            }
            case 'input': {
                const result = await p.text({
                    message: request.prompt,
                });

                if (p.isCancel(result)) {
                    return { value: '', cancelled: true };
                }
                return { value: result ?? '' };
            }
        }
    }
}
