import type { ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

export default function MainWorkspace({ children }: Props) {
    return (
        <main className="flex flex-col overflow-hidden bg-spur-bg">
            <div className="flex-1 overflow-auto">{children}</div>
        </main>
    );
}
