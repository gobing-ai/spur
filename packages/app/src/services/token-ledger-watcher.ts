/**
 * Token ledger file watcher (task 0247).
 *
 * Watches `.spur/context/token-ledger.jsonl` for growth and emits newly appended
 * parsed events to subscribers. Fail-soft: watch errors never throw to callers.
 */

import { closeSync, existsSync, type FSWatcher, fstatSync, openSync, readSync, watch } from 'node:fs';
import { parseLedgerLine, type ToolUseEvent } from './token-ledger-service';

/** Listener for newly appended ledger events (without page seq). */
export type TokenLedgerWatchListener = (event: Omit<ToolUseEvent, 'seq'>) => void;

/** Options for {@link TokenLedgerWatcher}. */
export interface TokenLedgerWatcherOptions {
    /** Absolute path to token-ledger.jsonl. */
    ledgerPath: string;
    /** Debounce ms for burst appends. Default 50. */
    debounceMs?: number;
}

/**
 * Watches a JSONL ledger for appends and fans out parsed events.
 */
export class TokenLedgerWatcher {
    private readonly ledgerPath: string;
    private readonly debounceMs: number;
    private readonly listeners = new Set<TokenLedgerWatchListener>();
    private watcher: FSWatcher | undefined;
    private offset = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | undefined;
    private started = false;
    private carry = '';

    constructor(options: TokenLedgerWatcherOptions) {
        this.ledgerPath = options.ledgerPath;
        this.debounceMs = options.debounceMs ?? 50;
    }

    /** Start watching; idempotent. */
    start(): void {
        if (this.started) return;
        this.started = true;
        this.offset = this.currentSize();
        try {
            // Watch the file if it exists; otherwise watch parent dir for create.
            const target = existsSync(this.ledgerPath) ? this.ledgerPath : this.parentDir();
            this.watcher = watch(target, () => this.schedulePoll());
        } catch {
            // Watch unsupported — leave started=true so poll can still be driven externally if needed.
            this.watcher = undefined;
        }
    }

    /** Stop watching and clear listeners. */
    stop(): void {
        this.started = false;
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        try {
            this.watcher?.close();
        } catch {
            /* ignore */
        }
        this.watcher = undefined;
        this.listeners.clear();
    }

    /**
     * Subscribe to new events. Returns unsubscribe.
     * Starts the watcher on first subscriber if not already started.
     */
    subscribe(listener: TokenLedgerWatchListener): () => void {
        this.listeners.add(listener);
        if (!this.started) this.start();
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size === 0) this.stop();
        };
    }

    /** Current number of subscribers (tests). */
    get subscriberCount(): number {
        return this.listeners.size;
    }

    private parentDir(): string {
        const idx = Math.max(this.ledgerPath.lastIndexOf('/'), this.ledgerPath.lastIndexOf('\\'));
        return idx > 0 ? this.ledgerPath.slice(0, idx) : '.';
    }

    private currentSize(): number {
        if (!existsSync(this.ledgerPath)) return 0;
        try {
            const fd = openSync(this.ledgerPath, 'r');
            try {
                return fstatSync(fd).size;
            } finally {
                closeSync(fd);
            }
        } catch {
            return 0;
        }
    }

    private schedulePoll(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = undefined;
            this.pollNewBytes();
        }, this.debounceMs);
    }

    /** Visible for tests — read and emit any bytes past the last offset. */
    pollNewBytes(): void {
        if (!existsSync(this.ledgerPath)) {
            this.offset = 0;
            this.carry = '';
            return;
        }
        let size: number;
        try {
            const fd = openSync(this.ledgerPath, 'r');
            try {
                size = fstatSync(fd).size;
                if (size < this.offset) {
                    // Truncated / rotated — reset.
                    this.offset = 0;
                    this.carry = '';
                }
                if (size === this.offset) return;
                const len = size - this.offset;
                const buf = Buffer.alloc(len);
                readSync(fd, buf, 0, len, this.offset);
                this.offset = size;
                const text = this.carry + buf.toString('utf8');
                const parts = text.split('\n');
                // Incomplete last line stays in carry.
                this.carry = parts.pop() ?? '';
                for (const line of parts) {
                    const evt = parseLedgerLine(line);
                    if (!evt) continue;
                    for (const listener of this.listeners) {
                        try {
                            listener(evt);
                        } catch {
                            /* isolate listener errors */
                        }
                    }
                }
            } finally {
                closeSync(fd);
            }
        } catch {
            /* fail-soft */
        }
    }
}
