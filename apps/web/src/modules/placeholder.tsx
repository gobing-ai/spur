import type { WebModule } from './types';

function PlaceholderView() {
    return (
        <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-semibold text-spur-text">Welcome</h2>
                <p className="text-spur-text-muted">Select a module from the sidebar to get started.</p>
            </div>
        </div>
    );
}

/** Placeholder module — replaced by Task Kanban in W3/0084. */
export const PlaceholderModule: WebModule = {
    id: 'board',
    name: 'Board',
    icon: '🏠',
    route: 'board',
    component: PlaceholderView,
};
