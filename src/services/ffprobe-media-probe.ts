import { spawnSync } from "node:child_process";
import type { MediaProbe, MediaProbeResult, MediaValidationRequirements } from "./artifact-validation.js";

export interface CommandResult {
  status: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export type CommandRunner = (executable: string, args: string[], options: { timeoutMs: number; maxBuffer: number }) => CommandResult;

const defaultCommandRunner: CommandRunner = (executable, args, options) => {
  const result = spawnSync(executable, args, { encoding: "utf8", timeout: options.timeoutMs, maxBuffer: options.maxBuffer, windowsHide: true });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...(result.error ? { error: result.error } : {}) };
};

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  duration?: string;
  start_time?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string; size?: string };
}

function ratio(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  return numerator / denominator;
}

function parsePayload(output: string): ProbePayload {
  try { return JSON.parse(output) as ProbePayload; } catch { throw new Error("ffprobe returned malformed JSON."); }
}

function runOrThrow(runner: CommandRunner, executable: string, args: string[], timeoutMs: number, label: string): CommandResult {
  const result = runner(executable, args, { timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw new Error(`${label} could not be executed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label} failed${result.signal ? ` with signal ${result.signal}` : ""}: ${result.stderr.slice(0, 2000)}`);
  return result;
}

export class FfprobeMediaProbe implements MediaProbe {
  readonly source = "trusted-runtime" as const;
  private readonly runner: CommandRunner;
  private readonly ffprobePath: string;
  private readonly ffmpegPath: string;
  private readonly timeoutMs: number;

  constructor(options: { ffprobePath?: string; ffmpegPath?: string; timeoutMs?: number; runner?: CommandRunner } = {}) {
    this.ffprobePath = options.ffprobePath ?? process.env.FFPROBE_PATH ?? "ffprobe";
    this.ffmpegPath = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.runner = options.runner ?? defaultCommandRunner;
  }

  inspect(absolutePath: string, requirements: MediaValidationRequirements): MediaProbeResult {
    const probe = runOrThrow(this.runner, this.ffprobePath, ["-v", "error", "-show_error", "-show_format", "-show_streams", "-print_format", "json", absolutePath], this.timeoutMs, "ffprobe");
    const payload = parsePayload(probe.stdout);
    const streams = payload.streams ?? [];
    const videoStreams = streams.filter((stream) => stream.codec_type === "video");
    const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
    const formatName = payload.format?.format_name ?? "";
    const durationSec = Number(payload.format?.duration ?? "NaN");
    const video = videoStreams[0];
    const audio = audioStreams[0];
    const videoDurationSec = Number(video?.duration ?? durationSec);
    const audioDurationSec = Number(audio?.duration ?? "NaN");
    const decode = {
      video: requirements.kind === "audio" ? "not_required" : this.decode(absolutePath, "video"),
      audio: requirements.requiredAudio || requirements.kind === "audio" ? this.decode(absolutePath, "audio") : "not_required"
    } as const;
    const playable = Boolean(payload.format && Number.isFinite(durationSec) && durationSec > 0 && (requirements.kind === "audio" ? audio : video));
    return {
      playable,
      mimeType: video ? (formatName.includes("mp4") ? "video/mp4" : "application/octet-stream") : (formatName.includes("mp3") ? "audio/mpeg" : formatName.includes("wav") ? "audio/wav" : "application/octet-stream"),
      durationSec,
      width: Number(video?.width ?? 0),
      height: Number(video?.height ?? 0),
      containerFormat: formatName,
      videoStreams: videoStreams.map((stream) => ({ index: Number(stream.index), codecName: stream.codec_name ?? "", durationSec: Number(stream.duration ?? durationSec), width: Number(stream.width ?? 0), height: Number(stream.height ?? 0), frameRate: ratio(stream.avg_frame_rate ?? stream.r_frame_rate) })),
      audioStreams: audioStreams.map((stream) => ({ index: Number(stream.index), codecName: stream.codec_name ?? "", durationSec: Number(stream.duration ?? "NaN"), sampleRate: Number(stream.sample_rate ?? 0), channels: Number(stream.channels ?? 0), channelLayout: stream.channel_layout })),
      decode,
      ...(requirements.requiredAudio || requirements.kind === "audio" ? { audioLoudness: this.measureAudioLoudness(absolutePath) } : {}),
      raw: { tool: "ffprobe", executable: this.ffprobePath, format: { formatName, durationSec, size: payload.format?.size }, videoCodec: video?.codec_name, audioCodec: audio?.codec_name, audioDurationSec, videoDurationSec, frameRate: ratio(video?.avg_frame_rate ?? video?.r_frame_rate) }
    };
  }

  private decode(path: string, stream: "video" | "audio"): "passed" {
    runOrThrow(this.runner, this.ffmpegPath, ["-nostdin", "-v", "error", "-xerror", "-i", path, "-map", `0:${stream === "video" ? "v:0" : "a:0"}`, "-f", "null", "-"], this.timeoutMs, `ffmpeg ${stream} decode`);
    return "passed";
  }

  private measureAudioLoudness(path: string): { meanDb: number; maxDb: number } {
    const result = runOrThrow(this.runner, this.ffmpegPath, ["-nostdin", "-v", "info", "-i", path, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"], this.timeoutMs, "ffmpeg audio loudness");
    const mean = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1];
    const max = result.stderr.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/)?.[1];
    if (mean === undefined || max === undefined) throw new Error("ffmpeg audio loudness analysis did not return volume measurements.");
    return { meanDb: Number(mean), maxDb: Number(max) };
  }
}
