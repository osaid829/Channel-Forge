import { InvalidTransitionError } from "./errors.js";
import type { ProductionJobState } from "./types.js";

const transitions: Record<ProductionJobState, readonly ProductionJobState[]> = {
  CREATED: ["PLANNING", "FAILED", "CANCELLED"],
  PLANNING: ["NARRATING", "FAILED", "CANCELLED"],
  NARRATING: ["SOURCING", "FAILED", "CANCELLED"],
  SOURCING: ["CAPTIONING", "FAILED", "CANCELLED"],
  CAPTIONING: ["RENDERING", "FAILED", "CANCELLED"],
  RENDERING: ["VALIDATING", "FAILED", "CANCELLED"],
  VALIDATING: ["REVIEW", "FAILED", "CANCELLED"],
  REVIEW: ["APPROVED", "FAILED", "CANCELLED"],
  APPROVED: [],
  FAILED: ["PLANNING", "CANCELLED"],
  CANCELLED: ["PLANNING"]
};

export const ACTIVE_PRODUCTION_STATES: readonly ProductionJobState[] = [
  "PLANNING",
  "NARRATING",
  "SOURCING",
  "CAPTIONING",
  "RENDERING",
  "VALIDATING"
];

export function canTransition(from: ProductionJobState, to: ProductionJobState): boolean {
  return transitions[from].includes(to);
}

export function assertLegalTransition(from: ProductionJobState, to: ProductionJobState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isActiveProductionState(state: ProductionJobState): boolean {
  return ACTIVE_PRODUCTION_STATES.includes(state);
}
