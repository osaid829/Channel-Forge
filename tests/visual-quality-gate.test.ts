import { describe, expect, it } from "vitest";
import { assessVisualQuality, type VisualFrameAnalysis } from "../src/services/visual-quality-gate.js";

const staticPlaceholderAnalysis: VisualFrameAnalysis = {
  sampleCount: 47,
  durationSec: 23.67,
  meanAbsoluteFrameDifferenceMean: 0.0010069,
  meanAbsoluteFrameDifferenceMax: 0.01528,
  nearIdenticalPairRatio: 44 / 46,
  frameMeanRange: 0.0077,
  frameStdDevRange: 0.0348
};

describe("visual quality gate", () => {
  it("flags the observed static placeholder scenario for review", () => {
    const result = assessVisualQuality(staticPlaceholderAnalysis);
    expect(result.status).toBe("review_required");
    expect(result.flags).toEqual([
      "excessive_static_frame_behavior",
      "placeholder_like_static_composition"
    ]);
  });

  it("passes meaningful frame variation without making semantic claims", () => {
    const result = assessVisualQuality({
      ...staticPlaceholderAnalysis,
      meanAbsoluteFrameDifferenceMean: 2.4,
      meanAbsoluteFrameDifferenceMax: 18,
      nearIdenticalPairRatio: 0.12,
      frameMeanRange: 28,
      frameStdDevRange: 12
    });
    expect(result.status).toBe("pass");
    expect(result.flags).toEqual([]);
  });

  it("does not reject or claim quality when no visual analysis is available", () => {
    expect(assessVisualQuality()).toMatchObject({
      status: "unassessed",
      flags: []
    });
  });

  it("keeps malformed or insufficient metrics reviewable instead of silently passing", () => {
    const result = assessVisualQuality({
      ...staticPlaceholderAnalysis,
      sampleCount: 1,
      nearIdenticalPairRatio: 2
    });
    expect(result.status).toBe("unassessed");
    expect(result.flags).toEqual(["insufficient_visual_samples"]);
  });
});
