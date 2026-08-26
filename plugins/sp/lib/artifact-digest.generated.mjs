// packages/domain/src/analytics/artifact-digest.ts
import { createHash } from "node:crypto";
var ARTIFACT_ARRAY_CLASSIFICATION = {
  byTool: "ranked",
  bySession: "ranked",
  topStepsByTokens: "ranked",
  topStepsByDuration: "ranked",
  topSteps: "ranked",
  bottlenecks: "ranked",
  coverage: "set",
  daily: "set",
  loops: "set",
  warnings: "set",
  pairings: "set",
  ladderSnapshot: "set",
  stepSupport: "set",
  phases: "set",
  tools: "set",
  skills: "set",
  sources: "set",
  models: "set"
};
var RANKED_ARTIFACT_KEYS = new Set(Object.entries(ARTIFACT_ARRAY_CLASSIFICATION).filter(([, kind]) => kind === "ranked").map(([key]) => key));
function canonicalize(value, key) {
  if (key === "generatedAt" || key === "validatedAt" || key === "baselineArtifactDigest")
    return null;
  if (Array.isArray(value)) {
    const raw = value.map((v) => JSON.stringify(canonicalize(v, "")));
    return RANKED_ARTIFACT_KEYS.has(key) ? raw : [...raw].sort();
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = canonicalize(value[k], k);
    }
    return out;
  }
  return value;
}
function semanticArtifactDigest(artifactJson) {
  const material = JSON.stringify(canonicalize(artifactJson, "root"));
  return createHash("sha256").update(material).digest("hex");
}
export {
  semanticArtifactDigest,
  RANKED_ARTIFACT_KEYS,
  ARTIFACT_ARRAY_CLASSIFICATION
};
