import { createApp } from './app';

/** Cloudflare Worker fetch entrypoint for the server app. */
export default {
    fetch(request: Request, env?: Record<string, string | undefined>) {
        const app = createApp();
        return app.fetch(request, env);
    },
};
