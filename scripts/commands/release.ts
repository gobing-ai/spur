// Thin forwarder (task 0617, ADR-051): the release logic was promoted to the public
// `spur builder` noun; spur-dev keeps working through the same single implementation.
export { bumpVer, dropTags } from '../../apps/cli/src/release-ops';
