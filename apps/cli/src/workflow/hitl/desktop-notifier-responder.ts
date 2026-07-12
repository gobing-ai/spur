import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';
import type { HitlAnswer, HitlRequest, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
// node-notifier lives behind this tiny wrapper module: referencing it from here directly
// (statically or via dynamic import()) destroys this file's per-file coverage attribution
// under Bun's V8 coverage — see desktop-notify.ts.
import { desktopNotify } from './desktop-notify';

/** Configuration for DesktopNotifierHitlResponder. */
export interface DesktopNotifierHitlResponderConfig {
    /** confirm fallback: 'yes' | 'no' | 'cancel' (default 'no' — deny). */
    confirmDefault?: string;
    /** select fallback: index into options (default 0). */
    selectDefaultIndex?: number;
    /** input fallback: string (default ''). */
    inputDefault?: string;
    /** Platform override (test seam); defaults to the live `os.platform()`. */
    platform?: string;
    /** osascript runner (test seam); defaults to a real `execFileSync('osascript', …)`. */
    runOsascript?: (script: string) => string;
    /** Notification sink (test seam); defaults to `desktopNotify` (node-notifier). */
    notify?: (title: string, message: string) => void;
}

/**
 * Default osascript runner: execute an AppleScript string synchronously, return trimmed stdout.
 * Exported so the default path stays testable with a harmless non-dialog script.
 */
export function runOsascriptDefault(script: string): string {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 30000 }).trim();
}

/**
 * Desktop HITL responder — native OS dialogs for prompts, node-notifier for notes.
 *
 * macOS (primary): confirm/select/input use `osascript` native dialogs (zero extra deps).
 * Other platforms: fall back to configured defaults (same as DefaultHitlResponder).
 *
 * `notify(title, message)` sends a desktop notification via node-notifier on all platforms.
 * This is fire-and-forget — no return value, no answer.
 */
export class DesktopNotifierHitlResponder implements HitlResponder {
    private readonly isMacOS: boolean;
    private readonly runOsascript: (script: string) => string;
    private readonly notifyFn: (title: string, message: string) => void;
    private readonly defaults: {
        confirm: string;
        selectIndex: number;
        input: string;
    };

    constructor(config?: DesktopNotifierHitlResponderConfig) {
        this.isMacOS = (config?.platform ?? platform()) === 'darwin';
        this.runOsascript = config?.runOsascript ?? runOsascriptDefault;
        this.notifyFn = config?.notify ?? desktopNotify;
        this.defaults = {
            confirm: config?.confirmDefault ?? 'no',
            selectIndex: config?.selectDefaultIndex ?? 0,
            input: config?.inputDefault ?? '',
        };
    }

    // -----------------------------------------------------------------------
    // HitlResponder contract — confirm / select / input
    // -----------------------------------------------------------------------

    async respond(request: HitlRequest): Promise<HitlAnswer> {
        if (!this.isMacOS) {
            return this.fallback(request);
        }

        switch (request.kind) {
            case 'confirm':
                return this.macConfirm(request);
            case 'select':
                return this.macSelect(request);
            case 'input':
                return this.macInput(request);
        }
    }

    // -----------------------------------------------------------------------
    // Note display (fire-and-forget, not part of HitlResponder)
    // -----------------------------------------------------------------------

    /**
     * Fire a desktop notification. Non-blocking; never throws.
     */
    notify(title: string, message: string): void {
        try {
            this.notifyFn(title, message);
        } catch {
            // Silently swallow — notes are best-effort display.
        }
    }

    // -----------------------------------------------------------------------
    // macOS native dialogs (osascript)
    // -----------------------------------------------------------------------

    private macConfirm(request: HitlRequest): HitlAnswer {
        const script = `display dialog "${this.escape(request.prompt)}" buttons {"Yes","No","Cancel"} default button "Yes"`;
        try {
            const result = this.runOsascript(script);
            if (result.includes('Yes')) return { value: 'yes' };
            return { value: 'no' };
        } catch (error) {
            // Clicking the Cancel button makes osascript exit non-zero with "User canceled. (-128)";
            // it never reaches stdout. Map it to a real cancel, not the configured default.
            if (isUserCancel(error)) return { value: 'cancel', cancelled: true };
            return { value: this.defaults.confirm };
        }
    }

    private macSelect(request: HitlRequest): HitlAnswer {
        const options = request.options ?? [];
        if (options.length === 0) {
            return { value: '', cancelled: true };
        }
        const quoted = options.map((o) => `"${this.escape(o)}"`).join(', ');
        const script = `choose from list {${quoted}} with prompt "${this.escape(request.prompt)}"`;
        try {
            const result = this.runOsascript(script);
            // AppleScript's `choose from list` returns the literal string "false" on cancel.
            if (result === 'false') return { value: '', cancelled: true };
            const match = result.match(/^([a-zA-Z].*)/m);
            if (match?.[1]) return { value: match[1] };
            return { value: '', cancelled: true };
        } catch (error) {
            if (isUserCancel(error)) return { value: '', cancelled: true };
            const idx = Math.max(0, Math.min(this.defaults.selectIndex, options.length - 1));
            return { value: options[idx] ?? options[0] ?? '' };
        }
    }

    private macInput(request: HitlRequest): HitlAnswer {
        const script = `display dialog "${this.escape(request.prompt)}" default answer ""`;
        try {
            const result = this.runOsascript(script);
            // osascript returns 'button returned:OK, text returned:<value>'
            const match = result.match(/text returned:(.+)/m);
            if (match) return { value: match[1]?.trimEnd() ?? '' };
            return { value: '' };
        } catch (error) {
            if (isUserCancel(error)) return { value: '', cancelled: true };
            return { value: this.defaults.input };
        }
    }

    // -----------------------------------------------------------------------
    // Fallback for non-macOS platforms
    // -----------------------------------------------------------------------

    private fallback(request: HitlRequest): HitlAnswer {
        switch (request.kind) {
            case 'confirm':
                return { value: this.defaults.confirm };
            case 'select': {
                const options = request.options ?? [];
                const idx = Math.max(0, Math.min(this.defaults.selectIndex, options.length - 1));
                return { value: options[idx] ?? '' };
            }
            case 'input':
                return { value: this.defaults.input };
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /** Basic AppleScript string escaping. */
    private escape(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
}

/** osascript signals a user-cancelled dialog by exiting non-zero with "User canceled. (-128)". */
function isUserCancel(error: unknown): boolean {
    const e = error as { message?: string; stderr?: string } | undefined;
    return `${e?.message ?? ''}\n${e?.stderr ?? ''}`.includes('-128');
}
