import { describe, expect, it } from 'bun:test';
import { projectDisplayName } from '@/components/ProjectSwitcher';

describe('projectDisplayName', () => {
    it('appends the host for remote entries', () => {
        expect(projectDisplayName({ name: 'knowledge-kit', host: '192.168.87.27' })).toBe(
            'knowledge-kit (192.168.87.27)',
        );
        expect(projectDisplayName({ name: 'kk', host: 'dev.example.com' })).toBe('kk (dev.example.com)');
    });

    it('keeps the bare name for local or missing hosts', () => {
        for (const host of [undefined, '', 'localhost', 'LOCALHOST', '127.0.0.1', '::1', ' localhost ']) {
            expect(projectDisplayName({ name: 'spur-new', host })).toBe('spur-new');
        }
    });
});
