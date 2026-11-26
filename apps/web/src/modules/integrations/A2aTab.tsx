import type { IntegrationsStatus, IntegrationsUsage } from '@gobing-ai/spur-contracts';
import { A2aConfigDrawer } from './A2aConfigDrawer';
import { A2aSequence, type SequenceClient } from './A2aSequence';
import type { InboxRequestRow, ProtocolEventRow, UsageWindow } from './helpers';

/**
 * Integrations › A2A (task 1424 R5; inspection 1440; the cooperation sequence 1454).
 *
 * Three regions in one order: the no-inbound warning (visible, because nothing can reach the
 * project), the **sequence** — the tab's primary content since 1454 — and the **Configuration**
 * disclosure holding today's Members content. The warning stays above the sequence rather than inside
 * the collapsed drawer: a listener that serves no inbound member is unusable, and an operator must not
 * have to open a disclosure to learn that.
 */
export function A2aTab({
    status,
    requests,
    receipts,
    events,
    usage,
    window,
    client,
    fetchCard,
}: {
    status: IntegrationsStatus;
    requests: InboxRequestRow[];
    receipts: Array<{ member: string; rows: InboxRequestRow[] }>;
    events: ProtocolEventRow[];
    usage: IntegrationsUsage | null;
    /** The module header's usage window: the sequence's lower time bound. */
    window: UsageWindow;
    /** The `inbox.timeline`/`inbox.requests` pair; defaults to the production client. */
    client?: SequenceClient;
    fetchCard?: (url: string) => Promise<Response>;
}) {
    return (
        <div className="flex flex-col gap-4">
            {status.a2a.enabled && !status.a2a.members.some((member) => member.direction === 'inbound') ? (
                <p className="text-sm text-warning" data-testid="integrations-a2a-no-inbound">
                    The A2A listener is enabled but no member declares an inbound surface, so nothing can reach this
                    project. Declare a fleet member with an executor, or turn the listener off.
                </p>
            ) : null}
            <A2aSequence
                status={status}
                window={window}
                {...(client === undefined ? {} : { client })}
                {...(fetchCard === undefined ? {} : { fetchCard })}
            />
            <A2aConfigDrawer
                status={status}
                requests={requests}
                receipts={receipts}
                events={events}
                usage={usage}
                {...(fetchCard === undefined ? {} : { fetchCard })}
            />
        </div>
    );
}
