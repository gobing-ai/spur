import { useEffect, useState } from 'react';

export interface ToastMessage {
    id: string;
    message: string;
}

/**
 * Global api-error toast listener mounted at the Board layout root (Task 0388 R4).
 *
 * Listens for `api-error` CustomEvents fired anywhere in the app and displays
 * transient error toasts auto-dismissed after 5 seconds.
 */
export default function ApiErrorToast() {
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleApiError = (event: Event) => {
            const customEvent = event as CustomEvent<{ message?: string }>;
            const message = customEvent.detail?.message || 'An error occurred';
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

            setToasts((prev) => [...prev, { id, message }]);

            // Auto dismiss after 5s
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, 5000);
        };

        window.addEventListener('api-error', handleApiError);
        return () => {
            window.removeEventListener('api-error', handleApiError);
        };
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md w-full px-4 pointer-events-none">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className="pointer-events-auto flex items-center justify-between gap-3 p-3 bg-red-950/90 border border-red-500/40 text-red-200 text-sm rounded-md shadow-lg backdrop-blur"
                    role="alert"
                >
                    <span className="flex-1 break-words">{toast.message}</span>
                    <button
                        type="button"
                        className="text-red-400 hover:text-red-100 text-base font-bold leading-none px-1"
                        onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                        aria-label="Close error toast"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
