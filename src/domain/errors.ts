export type DomainErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_TRANSITION"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_AUTHORITY_INVALID"
  | "UNSAFE_PATH"
  | "ARTIFACT_VALIDATION_FAILED"
  | "DATABASE_ERROR";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", `${resource} not found: ${id}`, { resource, id });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("CONFLICT", message, details);
    this.name = "ConflictError";
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor(key: string, existingFingerprint: string, requestedFingerprint: string) {
    super("IDEMPOTENCY_CONFLICT", `Idempotency key has a different payload: ${key}`, {
      key,
      existingFingerprint,
      requestedFingerprint
    });
    this.name = "IdempotencyConflictError";
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(fromState: string, toState: string) {
    super("INVALID_TRANSITION", `Invalid transition: ${fromState} -> ${toState}`, {
      fromState,
      toState
    });
    this.name = "InvalidTransitionError";
  }
}

export class ApprovalRequiredError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("APPROVAL_REQUIRED", message, details);
    this.name = "ApprovalRequiredError";
  }
}

export class ApprovalAuthorityInvalidError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("APPROVAL_AUTHORITY_INVALID", message, details);
    this.name = "ApprovalAuthorityInvalidError";
  }
}

export class UnsafePathError extends DomainError {
  constructor(relativePath: string) {
    super("UNSAFE_PATH", `Unsafe artifact path: ${relativePath}`, { relativePath });
    this.name = "UnsafePathError";
  }
}

export class ArtifactValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("ARTIFACT_VALIDATION_FAILED", message, details);
    this.name = "ArtifactValidationError";
  }
}
