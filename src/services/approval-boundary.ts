import { randomUUID } from "node:crypto";
import { ApprovalAuthorityInvalidError } from "../domain/errors.js";

export interface ApprovalRequest {
  productionJobId: string;
  reviewFingerprint: string;
  artifactIds: string[];
}

export interface HumanApprovalReceipt {
  readonly receiptId: string;
  readonly authorityId: string;
  readonly issuedAt: string;
}

export interface HumanApprovalIssuer {
  issue(request: ApprovalRequest): HumanApprovalReceipt;
}

export interface HumanApprovalVerifier {
  verify(receipt: HumanApprovalReceipt, request: ApprovalRequest): void;
}

type StoredReceipt = ApprovalRequest & { receiptId: string; authorityId: string };
const receipts = new WeakMap<object, StoredReceipt>();

class Boundary implements HumanApprovalIssuer, HumanApprovalVerifier {
  constructor(private readonly authorityId: string) {}

  issue(request: ApprovalRequest): HumanApprovalReceipt {
    const receipt = Object.freeze({
      receiptId: randomUUID(),
      authorityId: this.authorityId,
      issuedAt: new Date().toISOString()
    });
    receipts.set(receipt, { ...request, receiptId: receipt.receiptId, authorityId: receipt.authorityId });
    return receipt;
  }

  verify(receipt: HumanApprovalReceipt, request: ApprovalRequest): void {
    const stored = receipts.get(receipt as object);
    if (!stored || stored.authorityId !== this.authorityId || stored.receiptId !== receipt.receiptId || stored.productionJobId !== request.productionJobId || stored.reviewFingerprint !== request.reviewFingerprint || stored.artifactIds.join("\n") !== request.artifactIds.join("\n")) {
      throw new ApprovalAuthorityInvalidError("Approval receipt is not issued for the exact reviewed revision", { productionJobId: request.productionJobId });
    }
  }
}

export function createHumanApprovalBoundary(authorityId: string): { issuer: HumanApprovalIssuer; verifier: HumanApprovalVerifier } {
  if (!authorityId.trim()) throw new ApprovalAuthorityInvalidError("Human approval authority ID cannot be empty");
  const boundary = new Boundary(authorityId);
  return { issuer: boundary, verifier: boundary };
}
