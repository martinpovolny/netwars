// Enemy roster + level goals now live in shared/constants.json.
// This module stays as the stable import point for the rest of the client.
import { K, ENEMY_TYPES, goalsForLevel } from '../shared/constants.js';

export { ENEMY_TYPES, goalsForLevel };
export const PODS_PER_LEVEL = K.pods.perLevel;
