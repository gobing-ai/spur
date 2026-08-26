/** Task summary DTO from the contract — mirrors taskContract.list output. */
export interface TaskSummary {
    wbs: string;
    name: string;
    status: string;
    priority?: string;
    type?: string;
    featureId?: string | null;
    parentWbs?: string | null;
    filePath: string;
    updatedAt?: string;
}

/** Query filters mapped to the task list contract. `assignee` is client-side until the list contract grows it. */
export interface TaskListFilters {
    status?: string;
    featureId?: string;
    parentWbs?: string;
    assignee?: string;
    folder?: string;
}
