import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGIN = join(import.meta.dir, '..');

test('shipping checks project strict completion instead of accepting an active feature', () => {
    const verifier = readFileSync(join(PLUGIN, 'skills/code-verification/SKILL.md'), 'utf8');
    const shipGate = verifier.split('### Step 13 — Shippable readiness gate')[1]?.split('### Step 14')[0] ?? '';
    expect(shipGate).toContain('feature check <featureId> --as done --strict --json');
    expect(shipGate).toContain('PASS feature-verification receipts and required dogfood evidence');
    for (const name of ['dev-verify', 'dev-verifyall']) {
        const command = readFileSync(join(PLUGIN, `commands/${name}.md`), 'utf8');
        expect(command).toContain('spur feature check <id> --as done --strict');
    }
    const spine = readFileSync(join(PLUGIN, 'skills/spur-dev/references/dev-operations.md'), 'utf8');
    expect(spine).toContain('spur feature check <id> --as done --strict --json');
});
