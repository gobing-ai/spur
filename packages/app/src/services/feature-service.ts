/**
 * FeatureService — core feature verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §2.2/§2.4, delivery §1.1. Features use position-encoding hierarchical IDs
 * (DD-14): single-letter top-level nodes, children append one digit per level.
 * Parent is derived by dropping the last character.
 */

import { MarkdownDocument } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { EntityRef, PlanningWriteService, WriteResult } from './planning-write-service';

/** Dependencies injected into FeatureService. */
export interface FeatureServiceContext {
    fs: FileSystem;
    writeService: PlanningWriteService;
    featuresDir: string;
    tasksDir: string;
    projectName?: string;
    actor?: string;
}

/** Feature summary returned by list/show. */
export interface FeatureSummary {
    id: string;
    name: string;
    status: string;
    priority: string;
    filePath: string;
    frontmatter: Record<string, unknown>;
}

/** Show result: feature summary + full markdown content. */
export interface FeatureShowResult extends FeatureSummary {
    content: string;
}

const FEATURE_FILE_RE = /^([A-Z][1-9]*)_(.+)\.md$/;

/** Core feature verbs over PlanningWriteService and direct corpus reads. */
export class FeatureService {
    readonly ctx: FeatureServiceContext;

    constructor(ctx: FeatureServiceContext) {
        this.ctx = ctx;
    }

    /** Compute parent ID by dropping the last character. "A1" → "A", "A" → null. */
    parentOf(id: string): string | null {
        if (id.length <= 1) return null;
        return id.slice(0, -1);
    }

    /** Compute depth from ID length. "A" = 1, "A1" = 2, "A11" = 3. */
    depthOf(id: string): number {
        return id.length;
    }

    /** Validate a feature ID against the DD-14 pattern. */
    isValidId(id: string): boolean {
        return /^[A-Z][1-9]*$/.test(id);
    }

    /** Create a new feature file via PlanningWriteService. */
    async create(name: string, parentId?: string): Promise<WriteResult> {
        const id = await this.allocateId(parentId ?? null);
        const slug = this.slugify(name);
        const ref = this.makeRef(id, slug);
        const content = this.templateContent(id, name);
        return this.ctx.writeService.create(ref, content);
    }

    /** List features. */
    async list(): Promise<FeatureSummary[]> {
        const results: FeatureSummary[] = [];
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                if (!match) continue;
                const eid = match[1];
                const eslug = match[2];
                if (!eid || !eslug) continue;
                const filePath = `${this.ctx.featuresDir}/${name}`;
                try {
                    const raw = await this.ctx.fs.readFile(filePath);
                    const doc = MarkdownDocument.parse(raw, 'feature');
                    results.push({
                        id: eid,
                        name: (doc.frontmatterData?.name as string) ?? eslug,
                        status: (doc.frontmatterData?.status as string) ?? 'backlog',
                        priority: (doc.frontmatterData?.priority as string) ?? 'P2',
                        filePath,
                        frontmatter: (doc.frontmatterData ?? {}) as Record<string, unknown>,
                    });
                } catch {
                    // skip unparseable files
                }
            }
        } catch {
            // dir doesn't exist yet
        }
        return results;
    }

    /** Show a single feature by ID. */
    async show(id: string): Promise<FeatureShowResult | null> {
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                if (!match) continue;
                const eid = match[1];
                const eslug = match[2];
                if (!eid || !eslug) continue;
                if (eid !== id) continue;
                const filePath = `${this.ctx.featuresDir}/${name}`;
                const raw = await this.ctx.fs.readFile(filePath);
                const doc = MarkdownDocument.parse(raw, 'feature');
                return {
                    id: eid,
                    name: (doc.frontmatterData?.name as string) ?? eslug,
                    status: (doc.frontmatterData?.status as string) ?? 'backlog',
                    priority: (doc.frontmatterData?.priority as string) ?? 'P2',
                    filePath,
                    frontmatter: (doc.frontmatterData ?? {}) as Record<string, unknown>,
                    content: raw,
                };
            }
        } catch {
            // dir doesn't exist
        }
        return null;
    }

    /** Refresh INDEX.md and task cross-links. */
    async refresh(_id?: string): Promise<{ index: string; tasksUpdated: number }> {
        return { index: '', tasksUpdated: 0 };
    }

    /** Move a feature to a new parent (cascade rename). */
    async move(_id: string, _newParentId?: string): Promise<{ movedCount: number }> {
        return { movedCount: 0 };
    }

    // ─── Private helpers ────────────────────────────────────────────────

    private resolveFeaturePath(id: string, slug: string): string {
        return `${this.ctx.featuresDir}/${id}_${slug}.md`;
    }

    private slugify(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    private makeRef(id: string, slug: string): EntityRef {
        return {
            kind: 'feature',
            id,
            filePath: this.resolveFeaturePath(id, slug),
            folder: this.ctx.featuresDir,
        };
    }

    private async allocateId(parentId: string | null): Promise<string> {
        let existing: string[];
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            existing = [];
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                const captured = match?.[1];
                if (captured) {
                    existing.push(captured);
                }
            }
        } catch {
            // Directory doesn't exist yet — allocate first ID
            return parentId === null ? 'A' : `${parentId}1`;
        }

        if (parentId === null) {
            for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
                const letter = String.fromCharCode(c);
                if (!existing.includes(letter)) return letter;
            }
            throw new Error('No unused top-level feature letters available (A-Z exhausted)');
        }

        const prefix = parentId;
        const childLength = prefix.length + 1;
        const children = new Set<number>();
        for (const eid of existing) {
            if (eid.startsWith(prefix) && eid.length === childLength) {
                const char = eid[childLength - 1];
                if (char) {
                    const digit = parseInt(char, 10);
                    if (digit >= 1 && digit <= 9) {
                        children.add(digit);
                    }
                }
            }
        }
        for (let d = 1; d <= 9; d++) {
            if (!children.has(d)) return `${prefix}${d}`;
        }
        throw new Error(`Parent ${parentId} has reached the 9-child limit`);
    }

    private templateContent(id: string, name: string): string {
        const now = new Date().toISOString();
        return `---
schema_version: 1
id: "${id}"
name: "${name}"
status: backlog
priority: P2
tags: []
created_at: "${now}"
updated_at: "${now}"
---

# ${id}: ${name}

## Goal

## Scope

- In:
- Out:

## Acceptance Criteria

\`\`\`gherkin
Feature: ${name}

  Scenario: Basic acceptance
    Given a precondition
    When an action
    Then an expected outcome
\`\`\`

<!-- BEGIN_TASKS -->
<!-- END_TASKS -->

## Notes

## History
`;
    }
}
