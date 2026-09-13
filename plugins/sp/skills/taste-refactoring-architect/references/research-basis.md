# Research Basis and Industry Practices

This skill treats “STOA” as **state-of-the-art architecture techniques** rather than as a single formal standard. If a team uses a specific internal framework named STOA, map its terminology into the intervention ladder and quality model in this skill.

## Quality attributes
ISO/IEC 25010:2023 provides a modern product quality model with nine characteristics and sub-characteristics. The skill uses it as a vocabulary for preservation contracts and quality trade-offs, while adding delivery/operability concerns that architecture teams usually need in practice.

## Well-Architected thinking
AWS Well-Architected uses six pillars: operational excellence, security, reliability, performance efficiency, cost optimization, and sustainability. The skill borrows the idea that architecture is evaluated through explicit trade-offs and operational evidence, not pattern compliance.

Google Cloud’s Architecture Framework emphasizes robust system design, decoupling where useful, documentation, high availability/scalability, and cost-conscious design. This skill uses these ideas but explicitly warns against adding decoupling when it increases complexity without delivering a quality benefit.

## Evolutionary architecture
Evolutionary architecture practices emphasize guided incremental change, fitness functions, reversible decisions, and continuous feedback. The skill therefore requires measurable fitness functions and prefers small migration steps over big-bang rewrites.

## Team/service ownership
Single-team ownership patterns such as STOSA and modern team-topology thinking reinforce the principle that service boundaries should have clear operational ownership. The skill treats shared/no ownership as a refactoring smell and favors boundaries that align responsibility, data, change cadence, and operations.

## Incremental modernization
Strangler-style modernization and compatibility seams are used as migration techniques when replacement is necessary. The objective is not to preserve legacy structure, but to preserve behavior while shrinking risk and allowing progressive deletion.

## Architecture documentation
C4-style abstraction levels and ADRs are compatible with this skill: use diagrams to communicate current/target structures and ADRs to record consequential trade-offs. Documentation is useful only when it remains consistent with runtime evidence.

## Guiding synthesis
The distinctive bias of this skill is:

> **Reduce first. Re-boundary second. Enhance only against a named quality gap. Redesign last. Prove every structural change against preserved features and delivery qualities.**
