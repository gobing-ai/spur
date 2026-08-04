/**
 * Fixed leading tabs for the Inbox module (0422 R1). `All` is position 1,
 * `Supervisor` is position 2; both render even when no team is running.
 * Append-only, id-stable — never reorder or rename an entry.
 */
export interface InboxTab {
    readonly id: string;
    readonly label: string;
}

/** Fixed leading tabs for the Inbox module (0422 R1). */
export const FIXED_INBOX_TABS: readonly InboxTab[] = [
    { id: 'all', label: 'All' },
    { id: 'supervisor', label: 'Supervisor' },
];
