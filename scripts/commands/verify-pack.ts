/**
 * Tarball verification entrypoint (A93 1355). Thin forwarder over the shared app-owned verifier:
 * member safety is validated before extraction and versions come from the archive's own
 * `package/package.json`, never from this checkout.
 */
import { verifyPack } from '@gobing-ai/spur-app/builder';

/** Extract-and-assert the packed tarball. Returns the process exit code. */
export async function verifyPackTarball(tarball: string): Promise<number> {
    try {
        const result = await verifyPack(tarball);
        console.log(
            `verify-pack: OK — ${tarball} ships sp plugin + marketplace (${result.version}, ${result.files} plugin files)`,
        );
        return 0;
    } catch (error) {
        console.error(`verify-pack: FAIL — ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}
