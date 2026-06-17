import type { ReactNode } from 'react';

interface Props {
    children?: ReactNode;
    mobileHeader?: ReactNode;
}

export default function MainWorkspace({ children, mobileHeader }: Props) {
    return (
        <main className="flex flex-col overflow-hidden bg-spur-bg">
            {mobileHeader}
            <div className="flex-1 overflow-auto">{children}</div>
        </main>
    );
}
