/**
 * `@gobing-ai/spur-app/builder` — the compiled-artifact build surface (A93 1354).
 *
 * One implementation, two transports: the `spur builder build-*` verbs (shipped contract) and the
 * repository forwarders under `scripts/commands/` used by package scripts and CI. Nothing here
 * reads a project database, so a build never boots the CLI's project runtime.
 */

export {
    BINARY_TARGETS,
    type BuildBinariesOptions,
    binaryAssetName,
    buildBinaries,
    releaseAssetNames,
    writeSha256Sums,
} from './binaries';
export { bundleConfig } from './bundle-config';
export { type BundleLayaWorkerOptions, bundleLayaWorker } from './bundle-laya-worker';
export { type BundlePluginsOptions, bundlePlugins } from './bundle-plugins';
export {
    BOARD_RUNTIME_MANIFEST_FILE,
    BOARD_RUNTIME_MANIFEST_VERSION,
    type BuildRunner as WebBuildRunner,
    bundleWeb,
} from './bundle-web';
export {
    type CheckDepsFinding,
    type CheckDepsOptions,
    checkDependencyDrift,
    checkDeps,
    type DependencyDrift,
    findStaleLinks,
    inScope,
    lockKeyInScope,
    lockKeyPackageName,
    readLockedDependencies,
    type StaleLink,
} from './check-deps';
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
    BOARD_DECLARATION_REQUIRED_LINES,
    boardAuthoringSource,
    boardDeclarationTarget,
    type EmitBoardTypesOptions,
    type EmitKitTypesOptions,
    emitBoardDeclarations,
    emitKitDeclarations,
    KIT_COMPONENT_DECLARATIONS,
    KIT_DECLARATION_REQUIRED_LINES,
    kitAuthoringSource,
    kitDeclarationEntry,
    kitDeclarationRoot,
    kitSourceRoot,
    renderBoardDeclaration,
    renderKitDeclarations,
} from './emit-board-types';
export {
    type EmitMigrationSqlOptions,
    emitMigrationSql,
    migrationSqlSource,
    migrationSqlTarget,
    renderMigrationSqlModule,
} from './emit-migration-sql';
export {
    type ArchiveMember,
    assertSafeMembers,
    parseArchiveListing,
    type TarRunner,
    verifyPack,
    verifyPackExtract,
    verifySpurPack,
    verifySpurPackExtract,
} from './verify-pack';
