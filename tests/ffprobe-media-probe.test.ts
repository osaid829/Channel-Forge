import { describe, expect, it } from "vitest";
import { FfprobeMediaProbe, type CommandRunner } from "../src/services/ffprobe-media-probe.js";
import { defaultRenderRequirements } from "../src/services/artifact-validation.js";

const probePayload = JSON.stringify({
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "23.666667", size: "2498390" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "h264", width: 1080, height: 1920, avg_frame_rate: "30/1", duration: "23.666667" },
    { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "44100", channels: 2, channel_layout: "stereo", duration: "23.660000" }
  ]
});

function runnerFor(probeOutput = probePayload, stderr = "[Parsed_volumedetect] mean_volume: -19.2 dB\n[Parsed_volumedetect] max_volume: -5.3 dB") {
  const calls: string[][] = [];
  const runner: CommandRunner = (executable, args) => {
    calls.push([executable, ...args]);
    if (executable === "ffprobe") return { status: 0, stdout: probeOutput, stderr: "" };
    return { status: 0, stdout: "", stderr };
  };
  return { runner, calls };
}

describe("FfprobeMediaProbe", () => {
  it("parses stream facts and requires full video/audio decode evidence", () => {
    const { runner, calls } = runnerFor();
    const result = new FfprobeMediaProbe({ ffprobePath: "ffprobe", ffmpegPath: "ffmpeg", runner }).inspect("/tmp/final.mp4", defaultRenderRequirements);
    expect(result.mimeType).toBe("video/mp4");
    expect(result.containerFormat).toContain("mp4");
    expect(result.videoStreams?.[0]).toMatchObject({ codecName: "h264", width: 1080, height: 1920, frameRate: 30 });
    expect(result.audioStreams?.[0]).toMatchObject({ codecName: "aac", sampleRate: 44100, channels: 2 });
    expect(result.decode).toEqual({ video: "passed", audio: "passed" });
    expect(result.audioLoudness).toEqual({ meanDb: -19.2, maxDb: -5.3 });
    expect(calls[0]).toContain("-v");
    expect(calls.filter((call) => call[0] === "ffmpeg")).toHaveLength(3);
  });

  it("fails closed on malformed or failed ffprobe output", () => {
    const malformed: CommandRunner = () => ({ status: 0, stdout: "not-json", stderr: "" });
    expect(() => new FfprobeMediaProbe({ runner: malformed }).inspect("/tmp/bad.mp4", defaultRenderRequirements)).toThrow("malformed JSON");
    const failed: CommandRunner = () => ({ status: 1, stdout: "", stderr: "invalid media" });
    expect(() => new FfprobeMediaProbe({ runner: failed }).inspect("/tmp/bad.mp4", defaultRenderRequirements)).toThrow("ffprobe failed");
  });
});
