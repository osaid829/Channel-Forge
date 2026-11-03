import { randomUUID } from "node:crypto";
import { ApprovalAuthorityInvalidError } from "../domain/errors.js";
import type { ProviderResolutionDecision } from "../domain/types.js";

export interface ProviderResolutionRequest {
  productionJobId: string;
  attemptId: string;
  expectedRevision: string;
  decision: ProviderResolutionDecision;
}

export interface ProviderResolutionReceipt {
  readonly receiptId: string;
  readonly operatorId: string;
  readonly issuedAt: string;
}

export interface ProviderResolutionIssuer {
  issue(request: ProviderResolutionRequest): ProviderResolutionReceipt;
}

export interface ProviderResolutionVerifier {
  verify(receipt: ProviderResolutionReceipt, request: ProviderResolutionRequest): void;
}

type StoredReceipt = ProviderResolutionRequest & { receiptId: string; operatorId: string };
const receipts = new WeakMap<object, StoredReceipt>();

class Boundary implements ProviderResolutionIssuer, ProviderResolutionVerifier {
  constructor(private readonly operatorId: string) {}

  issue(request: ProviderResolutionRequest): ProviderResolutionReceipt {
    const receipt = Object.freeze({ receiptId: randomUUID(), operatorId: this.operatorId, issuedAt: new Date().toISOString() });
    receipts.set(receipt, { ...request, receiptId: receipt.receiptId, operatorId: receipt.operatorId });
    return receipt;
  }

  verify(receipt: ProviderResolutionReceipt, request: ProviderResolutionRequest): void {
    const stored = receipts.get(receipt as object);
    if (!stored || stored.operatorId !== this.operatorId || stored.receiptId !== receipt.receiptId || stored.productionJobId !== request.productionJobId || stored.attemptId !== request.attemptId || stored.expectedRevision !== request.expectedRevision || stored.decision !== request.decision) {
      throw new ApprovalAuthorityInvalidError("Provider resolution receipt is not bound to the exact attempt and decision", { productionJobId: request.productionJobId, attemptId: request.attemptId });
    }
  }
}

export function createProviderResolutionBoundary(operatorId: string): { issuer: ProviderResolutionIssuer; verifier: ProviderResolutionVerifier } {
  if (!operatorId.trim()) throw new ApprovalAuthorityInvalidError("Provider resolution operator ID cannot be empty");
  const boundary = new Boundary(operatorId);
  return { issuer: boundary, verifier: boundary };
}
