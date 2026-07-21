import DOMPurify from 'dompurify';
import { useEffect, useId, useRef, useState } from 'react';
import { MDEditor } from '@/ui';

/**
 * Renders a fenced ```mermaid block as an SVG diagram.
 *
 * `mermaid` is loaded lazily on first mount so the (heavy) library stays out of
 * the initial bundle and off the path of tasks whose bodies have no diagrams.
 * The diagram is injected as HTML because mermaid returns a complete SVG string;
 * the markup is sanitized with DOMPurify (SVG profile) before injection, on top
 * of mermaid's own `securityLevel: 'strict'`. Render failures fall back to the
 * raw source, never a thrown error.
 */
export function MermaidBlock({ code }: { code: string }) {
    const id = useId().replace(/:/g, '');
    const containerRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const mermaid = (await import('mermaid')).default;
                mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
                const rendered = await mermaid.render(`mermaid-${id}`, code);
                const clean = DOMPurify.sanitize(rendered.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
                if (!cancelled) setSvg(clean);
            } catch {
                if (!cancelled) setError(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [code, id]);

    // Inject the DOMPurify-sanitized SVG via the DOM API (mermaid returns a
    // complete SVG string; there is no node-based render alternative). The
    // markup was sanitized with DOMPurify's SVG profile in the effect above,
    // on top of mermaid's own securityLevel:'strict'.
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.innerHTML = svg ?? '';
        }
    }, [svg]);

    if (error) {
        return (
            <pre>
                <code>{code}</code>
            </pre>
        );
    }
    return <div ref={containerRef} className="mermaid-diagram flex justify-center" data-testid="mermaid-diagram" />;
}

type CodeProps = {
    className?: string;
    children?: React.ReactNode;
};

/** Extract the language token from a `language-xxx` className, or null. */
export function languageOf(className: string | undefined): string | null {
    const match = (className ?? '').match(/language-(\w+)/);
    return match?.[1] ?? null;
}

/**
 * Recursively collect the plain text of a React node tree.
 *
 * rehype-prism-plus tokenizes fenced code into nested `<span>` elements, so a
 * code block's `children` is no longer a bare string. Mermaid needs the raw
 * un-highlighted source, so we walk the tree and concatenate its text leaves.
 */
export function nodeText(node: React.ReactNode): string {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join('');
    if (typeof node === 'object' && 'props' in node) {
        return nodeText((node as { props: { children?: React.ReactNode } }).props.children);
    }
    return '';
}

/**
 * Detail-body markdown renderer.
 *
 * The body renders in the normal (light) theme — `data-color-mode="light"` pins it
 * there regardless of the OS `prefers-color-scheme`. Only fenced code blocks get a
 * dark treatment, applied via scoped CSS in global.css (dark `pre` background + the
 * dark prettylights syntax palette). Syntax highlighting itself comes from
 * react-markdown-preview's bundled `rehype-prism-plus`. The only custom wiring is the
 * `code` component override that diverts ```mermaid fences to {@link MermaidBlock};
 * every other language renders through the default highlighter.
 */
/**
 * Renders a fenced code block, diverting ```mermaid to {@link MermaidBlock}.
 * Extracted from the default export for direct testing without MDEditor.Markdown.
 */
export function renderCodeBlock({ className, children, ...props }: CodeProps) {
    if (languageOf(className) === 'mermaid') {
        return <MermaidBlock code={nodeText(children).trim()} />;
    }
    return (
        <code className={className} {...props}>
            {children}
        </code>
    );
}

export default function MarkdownBody({ source }: { source: string }) {
    return (
        <MDEditor.Markdown
            source={source}
            wrapperElement={{ 'data-color-mode': 'light' }}
            components={{
                code: renderCodeBlock,
            }}
        />
    );
}
