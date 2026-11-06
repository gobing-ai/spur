import { Link, useNavigate } from 'react-router';

/**
 * Board URL for one task's linked runs on the Trace tab.
 * The shell reads `tab` once on mount and Trace reads `wbs` for `GET /api/runs/by-wbs/:wbs`.
 */
export function taskRunEvidenceHref(wbs: string): string {
    return `/board/observability?tab=trace&wbs=${encodeURIComponent(wbs)}`;
}

/**
 * Task-detail link to retained run evidence.
 * Enter and Space navigate once. The link does not run a workflow.
 */
export function TaskRunEvidenceLink({ wbs }: { wbs: string }) {
    const navigate = useNavigate();
    const href = taskRunEvidenceHref(wbs);
    return (
        <Link
            to={href}
            data-task-run-evidence={wbs}
            className="text-xs text-spur-accent underline"
            onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                navigate(href);
            }}
        >
            Run evidence for {wbs}
        </Link>
    );
}
