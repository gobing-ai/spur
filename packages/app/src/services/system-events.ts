// Public `@gobing-ai/spur-app/system-events` surface: the catalog (event-names) plus the
// envelope builders. Previously event-names re-exported the envelope module, which imports
// event-names back — this barrel replaces that loop with a one-way fan-in.
export * from './event-names';
export * from './system-event-envelope';
