import { MDEditor } from '@/ui';
import { nodeText, renderCodeBlock } from '../task-kanban/MarkdownBody';
import { createSlugTracker } from './DesignToc';

export interface DesignMarkdownBodyProps {
    source: string;
    className?: string;
}

export default function DesignMarkdownBody({ source, className }: DesignMarkdownBodyProps) {
    const tracker = createSlugTracker();

    const createHeading = (level: number) => {
        const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => {
            const text = nodeText(children).trim();
            const cleanText = text
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\*([^*]+)\*/g, '$1')
                .replace(/`([^`]+)`/g, '$1')
                .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                .trim();
            const id = tracker.nextId(cleanText);

            return (
                <Tag id={id} className="scroll-mt-6 group" {...props}>
                    {children}
                </Tag>
            );
        };
    };

    const components = {
        code: renderCodeBlock,
        h1: createHeading(1),
        h2: createHeading(2),
        h3: createHeading(3),
        h4: createHeading(4),
        h5: createHeading(5),
        h6: createHeading(6),
    };

    return (
        <div className={`design-markdown-container ${className ?? ''}`} data-testid="design-markdown-body">
            <MDEditor.Markdown
                source={source}
                wrapperElement={{ 'data-color-mode': 'light' }}
                components={components}
            />
        </div>
    );
}
