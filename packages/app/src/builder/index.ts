/**
 * `@gobing-ai/spur-app/builder` — the compiled-artifact build surface (A93 1354).
 *
 * One implementation, two transports: the `spur builder build-*` verbs (shipped contract) and the
 * repository forwarders under `scripts/commands/` used by package scripts and CI. Nothing here
 * reads a project database, so a build never boots the CLI's project runtime.
 */

export { binaryAssetName, buildBinaries, releaseAssetNames, writeSha256Sums } from './binaries';
export { bundleConfig } from './bundle-config';
export {
    BOARD_RUNTIME_MANIFEST_FILE,
    BOARD_RUNTIME_MANIFEST_VERSION,
    type BuildRunner as WebBuildRunner,
    bundleWeb,
} from './bundle-web';
export {
    type BuildArtifact,
    type BuildDiagnostics,
    BuildError,
    type BuildResult,
    type BuildRunner,
    buildCli,
    buildCompiledBinary,
    buildOutputPath,
    buildServer,
    type CompileRequest,
    LAYA_MLX_PACKAGE,
    layaMlxInstalled,
    patchLayaMlxSourceImport,
    patchTsRuntimeImport,
    resolveSourceRoot,
    UNUSED_LAYA_PEER,
} from './compile';
export {
    type ArchiveMember,
    assertSafeMembers,
    parseArchiveListing,
    type TarRunner,
    verifyPack,
    verifyPackExtract,
} from './verify-pack';
