/**
 * Content-hash utilities for envelope layer fingerprinting (0284 R1, R3).
 *
 * Each layer is fingerprinted by SHA-256 content hash. Invalidation is
 * per-layer and fingerprint-driven, not time-based: if a layer's content hash
 * changes, the layer is stale (0284 R3).
 *
 * Hash computation is deterministic across Claude Code and Codex adapters
 * (same input → same hex digest).
 */

import { createHash } from 'node:crypto';

/**
 * Compute the SHA-256 hex digest of a string.
 *
 * Deterministic for equal inputs regardless of platform or adapter.
 * Uses the Node.js `crypto` module available in Bun runtime.
 * This is a stable domain contract (0284 fingerprinting).
 *
 * @param content — The serialized text content to hash.
 * @returns 64-character lowercase hex SHA-256 digest.
 */
export function computeContentHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
}
