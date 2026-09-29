// Dynamic chunk split out of `entry.js` for the composed-path browser proof (task 0992 R1).
//
// The Board resolves it relative to the entry URL it was told to import, so serving the module's
// asset tree is what makes an on-demand chunk reachable — exactly the asset-prefix contract.

/** Value the probe renders once its on-demand chunk has loaded. */
export function lazyValue() {
    return 'composed-lazy-loaded';
}
