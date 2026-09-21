/** Frozen DecisionMaker readiness projection for `spur self status` (0911 D6). */
export interface DecisionReadiness {
    enabled: boolean;
    provider: 'typesafe';
    credentialPresent: boolean;
    state: 'disabled' | 'missing-key' | 'configured-not-probed';
    connectivity: 'not-probed';
    inlineSupport: 'defer-only';
}

/**
 * Compute offline DecisionMaker readiness from the merged config boolean and key presence only.
 * Reports configuration, not API validity: it constructs no provider, reads no project `.env`,
 * makes no network call and emits no key or endpoint userinfo/query (D6).
 */
export function computeDecisionReadiness(enabled: boolean, hasKey: boolean): DecisionReadiness {
    const credentialPresent = hasKey === true;
    let state: DecisionReadiness['state'];
    if (!enabled) {
        state = 'disabled';
    } else if (!credentialPresent) {
        state = 'missing-key';
    } else {
        state = 'configured-not-probed';
    }
    return {
        enabled,
        provider: 'typesafe',
        credentialPresent,
        state,
        connectivity: 'not-probed',
        inlineSupport: 'defer-only',
    };
}
