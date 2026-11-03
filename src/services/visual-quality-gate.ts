export interface VisualFrameAnalysis {
  sampleCount: number;
  durationSec: number;
  meanAbsoluteFrameDifferenceMean: number;
  meanAbsoluteFrameDifferenceMax: number;
  nearIdenticalPairRatio: number;
  frameMeanRange: number;
  frameStdDevRange: number;
}

export type VisualQualityStatus = "unassessed" | "pass" | "review_required";

export type VisualQualityFlag =
  | "insufficient_visual_samples"
  | "excessive_static_frame_behavior"
  | "placeholder_like_static_composition";

export interface VisualQualityAssessment {
  status: VisualQualityStatus;
  flags: VisualQualityFlag[];
  summary: string;
  metrics?: VisualFrameAnalysis;
}

const STATIC_MEAN_DIFFERENCE_THRESHOLD = 0.01;
const STATIC_MAX_DIFFERENCE_THRESHOLD = 0.02;
const PLACEHOLDER_RANGE_THRESHOLD = 1;
const NEAR_IDENTICAL_RATIO_THRESHOLD = 0.95;

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export function assessVisualQuality(
  analysis?: VisualFrameAnalysis
): VisualQualityAssessment {
  if (!analysis) {
    return {
      status: "unassessed",
      flags: [],
      summary: "Visual content review was not supplied by the media probe."
    };
  }

  const valid =
    Number.isInteger(analysis.sampleCount) &&
    analysis.sampleCount >= 2 &&
    Number.isFinite(analysis.durationSec) &&
    analysis.durationSec > 0 &&
    finiteNonNegative(analysis.meanAbsoluteFrameDifferenceMean) &&
    finiteNonNegative(analysis.meanAbsoluteFrameDifferenceMax) &&
    Number.isFinite(analysis.nearIdenticalPairRatio) &&
    analysis.nearIdenticalPairRatio >= 0 &&
    analysis.nearIdenticalPairRatio <= 1 &&
    finiteNonNegative(analysis.frameMeanRange) &&
    finiteNonNegative(analysis.frameStdDevRange);

  if (!valid) {
    return {
      status: "unassessed",
      flags: ["insufficient_visual_samples"],
      summary: "Visual content review could not be assessed from the supplied metrics.",
      metrics: analysis
    };
  }

  const isStatic =
    analysis.meanAbsoluteFrameDifferenceMean <= STATIC_MEAN_DIFFERENCE_THRESHOLD &&
    analysis.meanAbsoluteFrameDifferenceMax <= STATIC_MAX_DIFFERENCE_THRESHOLD &&
    analysis.nearIdenticalPairRatio >= NEAR_IDENTICAL_RATIO_THRESHOLD;

  if (!isStatic) {
    return {
      status: "pass",
      flags: [],
      summary: "Sampled frames show meaningful visual variation.",
      metrics: analysis
    };
  }

  const flags: VisualQualityFlag[] = ["excessive_static_frame_behavior"];
  if (
    analysis.frameMeanRange <= PLACEHOLDER_RANGE_THRESHOLD &&
    analysis.frameStdDevRange <= PLACEHOLDER_RANGE_THRESHOLD
  ) {
    flags.push("placeholder_like_static_composition");
  }

  return {
    status: "review_required",
    flags,
    summary: "Sampled frames are effectively static; human visual review is required.",
    metrics: analysis
  };
}
