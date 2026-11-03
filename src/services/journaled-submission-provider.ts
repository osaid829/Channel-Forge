import type { ProductionProvider, ProviderProductionRequest, ProviderSubmission } from "./production-provider.js";
import type { ProductionService } from "./production-service.js";
import { SubmissionJournal } from "./submission-journal.js";

export function journaledSubmissionProvider(
  service: ProductionService,
  jobId: string,
  provider: ProductionProvider,
  journalRoot: string,
  materialManifestFingerprint: string
): ProductionProvider {
  return {
    name: provider.name,
    async submitProduction(input: ProviderProductionRequest): Promise<ProviderSubmission> {
      const run = service.getProviderRun(jobId);
      if (!run) throw new Error("Provider run was not persisted before request journaling.");
      const requestFingerprint = run.requestFingerprint;
      const context = {
        productionJobId: jobId,
        providerRunId: run.id,
        attemptId: run.attemptId,
        correlationId: run.correlationId,
        requestFingerprint,
        materialManifestFingerprint
      };
      const journal = new SubmissionJournal(journalRoot, context);
      await journal.record("PREPARED", {});
      await journal.record("REQUEST_STARTED", {});
      try {
        const response = await provider.submitProduction(input);
        await journal.record("RESPONSE_RECEIVED", {
          providerTaskId: response.reference?.remoteTaskId,
          providerState: response.state,
          providerStatus: response.providerStatus,
          error: response.error
        });
        return response;
      } catch (error) {
        await journal.record("RESPONSE_RECEIVED", { providerState: "transport_error", error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    getProductionStatus: (reference) => provider.getProductionStatus(reference),
    getProductionArtifacts: (reference) => provider.getProductionArtifacts(reference),
    cancelProduction: (reference) => provider.cancelProduction(reference)
  };
}

export async function recordAcknowledgement(
  service: ProductionService,
  jobId: string,
  journal: SubmissionJournal,
  resultState: string,
  providerTaskId?: string,
  providerStatus?: number
): Promise<void> {
  const run = service.getProviderRun(jobId);
  if (!run) throw new Error("Provider run was not available for acknowledgement receipt.");
  if ((resultState === "accepted" || resultState === "processing") && providerTaskId) {
    await journal.record("ACKNOWLEDGEMENT_PERSISTED", { providerTaskId, providerState: resultState, providerStatus });
  }
}
