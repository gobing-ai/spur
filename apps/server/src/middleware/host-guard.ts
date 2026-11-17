/**
 * The guard's implementation moved to `@gobing-ai/spur-app` so the gateway can enforce it without
 * importing this package. Re-exported here so existing imports keep working unchanged.
 */
export { allowedHostnames, isAllowedHost, normalizeHostname, rejectHost } from '@gobing-ai/spur-app';
