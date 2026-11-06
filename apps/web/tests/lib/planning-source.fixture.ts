/** Browser boundary used by rendered planning consumers; no transport internals mocked. */
export class FakePlanningSource {
    static instances: FakePlanningSource[] = [];
    static get latest(): FakePlanningSource {
        const source = FakePlanningSource.instances.at(-1);
        if (!source) throw new Error('No planning connection was created');
        return source;
    }
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
        FakePlanningSource.instances.push(this);
    }
    close() {
        this.closed = true;
    }
    frame(data: string) {
        this.onmessage?.({ data } as MessageEvent);
    }
    emit(eventName: string, payload?: unknown) {
        this.frame(JSON.stringify({ eventName, payload }));
    }
}
