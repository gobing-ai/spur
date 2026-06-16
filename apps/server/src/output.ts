/**
 * Bridge between service-layer types (broad / string-based enums) and
 * contract-layer output schemas (narrow / literal enums).
 *
 * Handlers call `output(data)` to return data whose runtime shape is
 * validated by the Zod output schema in the oRPC contract. The cast
 * through `unknown` avoids `as any` so the `no-biome-suppressions`
 * and `noExplicitAny` rules both pass.
 *
 * @see design §2.4 — handlers delegate to services, Zod validates output.
 */
export function output<T>(data: unknown): T {
    return data as T;
}
