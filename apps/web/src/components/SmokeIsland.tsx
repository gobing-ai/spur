import { useState } from 'react';
import { Button } from '@/ui';

export default function SmokeIsland() {
    const [count, setCount] = useState(0);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-spur-bg text-spur-text">
            <h1 className="text-4xl font-bold">Spur Control Plane</h1>
            <p className="text-spur-text-muted">
                W1 stack migration — Astro static + React 19 + Tailwind v4 + daisyUI 5
            </p>
            <div className="flex gap-4 items-center">
                <Button variant="primary" onClick={() => setCount((c) => c + 1)}>
                    Clicked {count} times
                </Button>
                <Button variant="ghost">daisyUI btn-ghost</Button>
                <Button variant="outline">daisyUI btn-outline</Button>
            </div>
        </div>
    );
}
