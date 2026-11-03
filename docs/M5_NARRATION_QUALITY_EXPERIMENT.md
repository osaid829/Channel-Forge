# M5 Narration Quality Experiment

**Project:** Channel Forge  
**Date:** 2026-10-14  
**Hardware:** Apple Silicon MacBook Air M2, 8 GB unified memory  
**Status:** Experimental samples complete; production integration intentionally stopped

## 1. Executive result

The current M5 narration path is not Kokoro despite the transport values
`model=kokoro` and `voice=af_heart`. The active bridge invokes macOS Samantha
through `/usr/bin/say` and converts the result to MP3.

Kokoro 82M was evaluated first in an isolated Python 3.12 environment using
MLX-Audio. The model loaded and generated three WAV samples successfully. The
samples are technically valid and materially different in duration, loudness,
and pacing. Naturalness, pronunciation, and expressive quality remain **human
listening questions**; no automatic metric is treated as proof of creative quality.

No production bridge, MoneyPrinterTurbo configuration, canonical artifact, SQLite
database, or M5 render was changed.

## 2. Existing Samantha path

The current implementation is:

```text
MoneyPrinterTurbo
  -> POST /v1/audio/speech
  -> m5_speech_bridge.py
  -> MacOSSayProvider
  -> /usr/bin/say -v "Samantha (English (US))"
  -> FFmpeg MP3 conversion
```

The existing fallback remains intact at:

```text
m5_speech_bridge.py
```

Its provider identity is correctly reported as:

```text
provider: macos-say
model:    macos-samantha
voice:    macos-samantha
```

The `kokoro` and `af_heart` values are transport aliases only in the current
bridge.

## 3. Models investigated

### Kokoro 82M MLX

Selected for the first experiment.

```text
MLX model: mlx-community/Kokoro-82M-bf16
Parameters: 82M
Published model size: 355 MB
Output:    24 kHz WAV in this experiment
Voices:    54 presets according to MLX-Audio documentation
License:   Apache-2.0 weights; MLX-Audio runtime is MIT
```

The MLX-Audio documentation explicitly supports Apple Silicon, Kokoro, speed
control, and voices such as `af_heart`, `af_bella`, and `af_nova`.

References:

- https://github.com/Blaizzy/mlx-audio
- https://huggingface.co/mlx-community/Kokoro-82M-bf16
- https://huggingface.co/hexgrad/Kokoro-82M

### Qwen3-TTS 0.6B MLX

Not installed or executed in this experiment, per the smallest-model-first
constraint.

The current MLX-Audio-compatible candidate is:

```text
mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16
```

The published MLX model card reports approximately 0.9B parameters and a 2.49 GB
model size, despite the 0.6B family label. The original Qwen3-TTS project and
the MLX conversion are Apache-2.0. Qwen supports expressive control and several
English voices, but the larger footprint and more complex model/runtime make it
the second candidate for an 8 GB machine.

References:

- https://github.com/QwenLM/Qwen3-TTS
- https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16

The official Qwen package documentation is primarily PyTorch-oriented and
recommends a fresh environment; the MLX-Audio conversion is the relevant path
for this Mac. No Qwen inference speed or memory number is claimed because it was
not installed or run.

## 4. Isolated experiment environment

Environment:

```text
Directory:       m5-narration-experiment/
Python:          3.12.14
mlx:             0.32.3
mlx-audio:       0.5.9
MLX Metal:       0.32.3
misaki:          0.9.4 plus English text-processing dependencies
ffmpeg:          /opt/homebrew/bin/ffmpeg 9.0.2
```

The isolated environment was created with `uv`; it is not the ChannelForge
runtime environment and does not alter project dependencies.

The first model download fetched the Kokoro MLX weights and support files. The
Hugging Face model card reports 355 MB for the model artifact. The first process
also spent approximately 97 seconds fetching model files; subsequent runs used
the local cache.

## 5. Samples generated

All samples use the approved script:

```text
Why is the sky blue? Sunlight may look white, but it contains many colors. As sunlight travels through Earth's atmosphere, tiny air molecules scatter shorter blue wavelengths more strongly than longer red wavelengths. That scattered blue light reaches our eyes from across the sky. Near sunset, sunlight takes a longer path through air, leaving warmer colors more noticeable.
```

Samples:

```text
m5-narration-experiment/samples/why-is-the-sky-blue-af_heart.wav
m5-narration-experiment/samples/why-is-the-sky-blue-af_bella.wav
m5-narration-experiment/samples/why-is-the-sky-blue-af_nova.wav
```

Experiment metadata:

```text
m5-narration-experiment/samples/experiment-metadata.json
```

SHA-256:

```text
af_heart: a70fdfc3f853380baa003aa3b5f7507bf42dae74d2122dac8d8b164173c209f5
af_bella: a3aad1a6a75f153e0b507e426fac234e897ea7f2d37d193aec73967cc97ac12fe
af_nova:  b9d67e606eaa3cb1002cfe50719c807f09b452d3f0ffe7349222e545b4346947
```

## 6. Measured generation results

Warm-cache results from one process with one model load:

| Voice | Duration | Generation time | Real-time factor | Peak MLX memory | Peak process RSS | Peak amplitude | RMS |
|---|---:|---:|---:|---:|---:|---:|---:|
| `af_heart` | 22.875 s | 15.11 s | 0.66x | 2,585.8 MB | 432.0 MB | 0.621 | 0.0500 |
| `af_bella` | 23.600 s | 5.71 s | 0.24x | 2,585.8 MB | 432.0 MB | 0.460 | 0.0576 |
| `af_nova` | 19.875 s | 3.33 s | 0.17x | 2,585.8 MB | 432.0 MB | 0.256 | 0.0280 |

The first voice includes MLX pipeline warm-up/compilation. Later voice timings
are more representative of a warmed process. Peak MLX memory is the important
unified-memory measurement; process RSS alone under-reports GPU-backed MLX
allocations.

## 7. Technical audio validation

All three WAV files are:

```text
Codec:       PCM signed 16-bit little-endian
Sample rate: 24 kHz
Channels:    mono
```

FFmpeg full audio decodes completed successfully for all three files. No clipping
was observed: all peak amplitudes remained below 1.0. `volumedetect` results:

```text
af_heart: mean -26.0 dB, peak -4.8 dB
af_bella: mean -24.8 dB, peak -6.7 dB
af_nova:  mean -31.1 dB, peak -11.7 dB
```

The current Samantha reference artifact remains technically valid and measures:

```text
MP3, 24 kHz, mono, 23.657500 s
Mean -16.2 dB, peak -2.3 dB
```

Kokoro output has natural phonetic pauses according to the silence detector, but
silence timing is not a substitute for listening assessment.

## 8. Voice comparison and recommendation

These are engineering observations, not naturalness claims:

- `af_heart`: closest to the familiar target duration among the first voice
  presets, but 22.875 seconds leaves approximately 0.79 seconds relative to the
  23.667-second video. Highest measured peak of the three; listen for emphasis
  and any sharpness.
- `af_bella`: best duration fit at 23.600 seconds, only approximately 67 ms
  shorter than the video. Highest RMS and a moderate peak. Recommended first
  voice for owner listening because it minimizes timing changes while retaining
  useful loudness.
- `af_nova`: fastest and quietest sample, but 19.875 seconds is approximately
  3.79 seconds shorter than the video. It would require deliberate pacing or
  visual retiming and should not be inserted by stretching blindly.

No voice is selected for production until the owner listens to the three samples.

## 9. Narration architecture

Added:

```text
m5_narration_contract.py
```

The contract provides:

- `NarrationRequest`: text, voice ID, speed, and WAV/MP3 output format.
- `NarrationResult`: provider, model, voice, output path, MIME type, sample
  rate, channels, duration, generation time, byte size, SHA-256, and metadata.
- `NarrationProvider` protocol for pluggable local implementations.
- Fail-closed request/result validation.
- File identity construction from the generated output.

The current `m5_speech_bridge.py` Samantha implementation remains the optional
fallback and was not replaced or rewired. The Kokoro experiment is intentionally
not connected to MoneyPrinterTurbo yet.

## 10. Video compatibility

The existing M5 final video is approximately 23.666667 seconds long. The three
experimental durations imply:

```text
af_bella: approximately 0.067 s shorter — likely usable with a small lead/trail policy
af_heart: approximately 0.792 s shorter — requires explicit timing decision
af_nova:  approximately 3.792 s shorter — requires pacing or visual retiming
```

Do not stretch or truncate narration blindly. The next integration experiment
should either:

1. choose a voice whose natural duration fits the existing eight 3-second scenes;
2. adjust speed within the provider’s supported range and revalidate speech; or
3. retime the scene sequence intentionally while preserving the approved visual
   order.

The original M5 MP4 and audio artifacts were not modified.

## 11. Required owner listening review

For each sample, listen for:

- Naturalness versus Samantha.
- Correct pronunciation of `Rayleigh`, `wavelengths`, and `atmosphere`.
- Expressive emphasis on the opening question and sunset explanation.
- Pausing and sentence rhythm.
- Robotic artifacts, sibilance, or pitch instability.
- Speech completeness and intelligibility.
- Whether the voice feels appropriate for a science-explainer channel.

The owner must choose a voice, reject the candidate set, or request another
bounded experiment. No production integration or human approval was performed.

## 12. Tests and safeguards

Python contract and bridge tests:

```text
python3 -m unittest test_m5_narration_contract.py test_m5_speech_bridge.py
15 tests passed
```

ChannelForge regression suite after WAV validator support and the contract:

```text
npm test
8 test files passed; 62 tests passed

npm run typecheck
PASS — tsc --noEmit
```

No provider requests, paid API calls, publishing, SQLite mutation, or canonical
artifact modification occurred.

## 13. Conclusion

**Initial model recommendation:** Kokoro 82M MLX. It is substantially smaller
than the Qwen candidate, runs on MLX/Metal, generated all three samples locally,
and fits comfortably within the measured 2.59 GB peak MLX allocation on the
8 GB MacBook Air test environment.

**Initial voice recommendation for listening:** `af_bella`, because its natural
sample duration is closest to the existing 23.67-second video. This is a timing
recommendation, not a claim that it is the most natural voice.

**Production status:** Samantha remains the fallback. No voice has been promoted
to production. Wait for owner listening feedback before any bridge or render
integration.
