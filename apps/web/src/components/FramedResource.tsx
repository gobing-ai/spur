import type { CSSProperties } from 'react';

/**
 * Board-owned frame adapter for a configured URL resource (task 0991 R1–R5).
 *
 * A framed resource is a project-configured URL the Board embeds as-is. The Board does not operate
 * that application, so this adapter is deliberately thin: it frames the URL, names it accessibly and
 * always offers a way out. It establishes no relationship with the child document.
 *
 * R4 — the browser keeps every embedding restriction: the child's `frame-ancestors` /
 * `X-Frame-Options`, the host's `frame-src` and ordinary cross-origin rules all apply untouched.
 * Nothing here proxies, strips or rewrites headers, and nothing forces login or cookie behaviour.
 * There is deliberately **no `load` handler**: a frame load event means the browser committed a
 * document, which is not evidence that the framed application is usable. Treating it as readiness
 * would be a false claim, so no readiness state exists to observe — the frame either shows content
 * or the user follows the external link.
 *
 * R5 — no messaging SDK, no postMessage bridge, no child DOM access, no automatic permissions and no
 * custom sandbox promise. Switching away unmounts this component, so the child document is discarded
 * and its in-page state resets; no Board context, theme, route or data crosses the boundary in either
 * direction. `sandbox` is intentionally not set: restricting a configured application is a policy
 * decision the project owns, not something this adapter should silently impose.
 */
export interface FramedResourceProps {
    /** Module id, surfaced as a data attribute so layout and tests can identify the frame. */
    readonly moduleId: string;
    /** The project-configured URL, used verbatim as the frame source and the external link target. */
    readonly url: string;
    /** Accessible frame name — the configured module name. */
    readonly title: string;
}

/** Flex column so the frame takes the whole workspace and the child owns its own scrolling. */
const SHELL_STYLE: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
};

const FRAME_STYLE: CSSProperties = {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    border: '0',
    display: 'block',
};

export function FramedResource({ moduleId, url, title }: FramedResourceProps) {
    return (
        <div
            className="framed-resource"
            data-testid="framed-resource"
            data-module-id={moduleId}
            data-framed-url={url}
            style={SHELL_STYLE}
        >
            <div className="flex items-center justify-end gap-2 border-b border-spur-border bg-spur-surface px-3 py-1">
                {/* Always available, never a readiness signal: the escape hatch for a frame the
                    browser may have refused to render. */}
                <a
                    className="text-xs font-medium text-spur-text underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-spur-accent"
                    data-testid="framed-resource-external"
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open externally
                </a>
            </div>
            <iframe
                className="framed-resource-frame"
                data-testid="framed-resource-frame"
                src={url}
                title={title}
                style={FRAME_STYLE}
            />
        </div>
    );
}
