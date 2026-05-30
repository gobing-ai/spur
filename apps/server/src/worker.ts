import { createApp } from './app';

const app = createApp();

/** Cloudflare Worker fetch entrypoint for the server app. */
export default {
    fetch(request: Request, env?: Record<string, string | undefined>) {
        return app.fetch(request, env);
    },
};
