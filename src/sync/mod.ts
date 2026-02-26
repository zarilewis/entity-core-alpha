/**
 * Sync Module
 *
 * Handles synchronization between my core and embodiments.
 */

export {
  createVectorClock,
  increment,
  merge,
  compare,
  happensBefore,
  createVersionedEntity,
  updateVersion,
} from "./versioning.ts";

export {
  resolveIdentityConflict,
  resolveMemoryConflict,
  detectIdentityConflict,
  createConflictInfo,
  hasVersionConflict,
  type ResolutionStrategy,
} from "./conflict.ts";
