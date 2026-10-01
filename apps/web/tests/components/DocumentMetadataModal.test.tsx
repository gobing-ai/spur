import { registerHappyDom, teardownHappyDom } from '../happy-dom';

registerHappyDom();

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import DocumentMetadataModal from '../../src/components/DocumentMetadataModal';

afterEach(() => {
    cleanup();
});

afterAll(async () => {
    await teardownHappyDom();
});

describe('DocumentMetadataModal', () => {
    const sampleFrontmatterRaw = `kind: plan
title: E93 Refinement
status: done
version: 1.0.0
tags:
  - refine
  - history`;

    const sampleParsed = {
        kind: 'plan',
        title: 'E93 Refinement',
        status: 'done',
        version: '1.0.0',
        tags: ['refine', 'history'],
    };

    test('renders nothing when open is false', () => {
        const { queryByRole } = render(
            <DocumentMetadataModal
                open={false}
                onClose={() => {}}
                title="E93 Refinement"
                filePath="docs/plans/sample.md"
                frontmatterRaw={sampleFrontmatterRaw}
                frontmatter={sampleParsed}
            />,
        );
        expect(queryByRole('dialog')).toBeNull();
    });

    test('renders modal with title, file path, and structured properties when open is true', () => {
        const { getByRole, getByText } = render(
            <DocumentMetadataModal
                open={true}
                onClose={() => {}}
                title="E93 Refinement"
                filePath="docs/plans/sample.md"
                frontmatterRaw={sampleFrontmatterRaw}
                frontmatter={sampleParsed}
            />,
        );

        const dialog = getByRole('dialog');
        expect(dialog).toBeDefined();
        expect(getByText('Document Metadata')).toBeDefined();
        expect(getByText('docs/plans/sample.md')).toBeDefined();
        expect(getByText('done')).toBeDefined();
        expect(getByText('refine')).toBeDefined();
        expect(getByText('history')).toBeDefined();
    });

    test('switches between structured and raw YAML tabs', () => {
        const { getByRole, getByText } = render(
            <DocumentMetadataModal
                open={true}
                onClose={() => {}}
                title="E93 Refinement"
                filePath="docs/plans/sample.md"
                frontmatterRaw={sampleFrontmatterRaw}
                frontmatter={sampleParsed}
            />,
        );

        const rawTab = getByRole('tab', { name: /raw yaml/i });
        fireEvent.click(rawTab);

        expect(getByText(/kind: plan/)).toBeDefined();
        expect(getByRole('button', { name: /copy yaml/i })).toBeDefined();

        const propertiesTab = getByRole('tab', { name: /properties/i });
        fireEvent.click(propertiesTab);

        expect(getByText('done')).toBeDefined();
    });

    test('triggers onClose when close button is clicked', () => {
        let closed = false;
        const { getByRole } = render(
            <DocumentMetadataModal
                open={true}
                onClose={() => {
                    closed = true;
                }}
                title="E93 Refinement"
                filePath="docs/plans/sample.md"
                frontmatterRaw={sampleFrontmatterRaw}
                frontmatter={sampleParsed}
            />,
        );

        const closeBtn = getByRole('button', { name: /close metadata/i });
        fireEvent.click(closeBtn);
        expect(closed).toBe(true);
    });

    test('renders empty state when document has no frontmatter', () => {
        const { getByText } = render(
            <DocumentMetadataModal
                open={true}
                onClose={() => {}}
                title="Plain Doc"
                filePath="docs/plans/plain.md"
                frontmatterRaw={null}
                frontmatter={null}
            />,
        );

        expect(getByText(/no frontmatter metadata found/i)).toBeDefined();
    });
});
