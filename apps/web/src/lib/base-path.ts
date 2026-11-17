/**
 * The base-path contract lives under `src/components` because the module-kit barrel publishes it and
 * the board-type emitter only mirrors declarations inside that root (`apps/web/scripts` →
 * `emit-board-types`). Application code keeps importing it from `lib` as before.
 */
export * from '../components/base-path';
