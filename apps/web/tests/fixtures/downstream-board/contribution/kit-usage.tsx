/**
 * Installed-package typecheck proof for the shared module UI kit (A81 1349 R4).
 *
 * This file is type-checked against the packed and installed `@gobing-ai/spur` tarball
 * (`tsconfig.json` includes `contribution/**`), so the kit's declarations must resolve from the
 * package's `./board/ui` export — with no Spur checkout on the resolution path. It is never
 * imported by the browser entry; the runtime half lives in `index.tsx`.
 */

import type { ModuleTab } from '@gobing-ai/spur/board/ui';
import { Badge, Button, Card, ModuleHeader, ModuleShell, ModuleTabs, TimeRangePresets } from '@gobing-ai/spur/board/ui';

const TABS: readonly ModuleTab[] = [
    { id: 'one', label: 'One' },
    { id: 'two', label: 'Two' },
];

/** Compose the kit the way a contribution would; the rendered tree is the runtime half's job. */
export function KitEntryProof(value: string, onChange: (next: string) => void): unknown {
    return (
        <ModuleShell>
            <ModuleHeader
                icon={<span aria-hidden="true" />}
                title="Kit proof"
                subtitle="typed against the installed package"
                filters={<TimeRangePresets presets={['1h', 'all']} value="1h" onChange={() => {}} />}
                tabs={<ModuleTabs tabs={TABS} value={value} onChange={onChange} label="Proof tabs" idPrefix="kit" />}
            />
            <Card>
                <Badge>ready</Badge>
                <Button size="sm">Act</Button>
            </Card>
        </ModuleShell>
    );
}
