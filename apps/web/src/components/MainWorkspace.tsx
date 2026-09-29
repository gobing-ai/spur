import type { ReactNode } from 'react';

interface Props {
    children?: ReactNode;
    mobileHeader?: ReactNode;
    /**
     * A framed resource owns the workspace (task 0991 R2): the scroll container becomes a flex
     * column that hides its own overflow, so the frame takes exactly the space left beside the
     * sidebar and the framed document — not the Board — owns content scrolling.
     */
    framed?: boolean;
}

export default function MainWorkspace({ children, mobileHeader, framed = false }: Props) {
    return (
        <main className="flex flex-col h-full overflow-hidden bg-spur-bg">
            {mobileHeader}
            <div className={framed ? 'flex flex-1 min-h-0 flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-auto'}>
                {children}
            </div>
        </main>
    );
}
