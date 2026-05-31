/** Generate a compact opaque identifier for local Spur rows. */
export function createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
}
