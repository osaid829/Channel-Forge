# M5 Qwen3-TTS CustomVoice Experiment

**Date:** 2026-10-14  
**Status:** Experimental samples complete; no production integration

## Result

Qwen3-TTS 0.6B CustomVoice runs locally on the Apple Silicon M2/8 GB machine
through MLX-Audio. The smallest official MLX quantized checkpoint was selected:

```text
mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit
Published model size: 1.69 GB
License: Apache-2.0
```

The model loaded on Metal and generated all requested samples. The output is
technically valid WAV audio, but duration and peak-memory behavior are variable.
The samples require owner listening before any voice or instruction is selected.

## Compatibility and environment

```text
Hardware:       Apple M2, 8 GB unified memory
Architecture:   arm64
Python:         3.12.14 (isolated existing M5 environment)
MLX:            0.32.3
MLX Metal:      0.32.3
MLX-Audio:      0.5.9
Device:         mlx Device(gpu, 0)
Model load:     5.70 s warm-cache run
```

The existing `m5-narration-experiment/.venv` was reused. No production
dependencies were changed. The model was downloaded to the user Hugging Face
cache, not into a canonical artifact or database directory.

## Voices and controls tested

The model reported nine speakers:

```text
serena, vivian, uncle_fu, ryan, aiden, ono_anna, sohee, eric, dylan
```

All nine received a short English audition sample. The full approved M5 script
was generated with:

- Ryan, neutral.
- Ryan, warm/confident science-explainer instruction.
- Ryan, conversational teaching / wonder-to-sunset instruction.
- Aiden, warm approachable science-documentary instruction.

The MLX-Audio implementation documents `speed` as not directly supported, so
speed was not varied. Temperature and top-p were held at `0.7` / `0.95`, except
the animated Ryan case at temperature `0.75`.

## Measured generation results

The full-script runs used one model load and a 1024-token ceiling. Results are
not timing-compatible with the existing approximately 23.67-second video:

```text
Sample                               Duration   Generation   RTF     Peak MLX
m5-neutral-ryan.wav                  81.92 s    49.74 s      0.61x   10,155 MB
m5-curious-science-explainer-ryan    34.72 s    25.07 s      0.72x    6,934 MB
m5-animated-sunset-ryan              64.48 s    43.89 s      0.68x   10,420 MB
m5-aiden-warm-explainer-aiden        35.84 s    26.24 s      0.73x    6,977 MB
```

The neutral and animated runs reached unusually long durations, indicating that
the sampling/termination behavior needs bounded handling for production-like
use. A second bounded run used a 512-token ceiling:

```text
Sample                               Duration   Generation   Peak MLX
m5-neutral-ryan-bounded512.wav       28.64 s    19.16 s       6,366 MB
m5-curious-science-explainer-ryan    40.96 s    27.62 s       7,555 MB
m5-animated-sunset-ryan              29.60 s    21.04 s       6,507 MB
m5-aiden-warm-explainer-aiden        39.44 s    26.21 s       7,490 MB
```

Peak process RSS reached approximately 768 MB, while active MLX allocation was
approximately 1.68 GB after generation. The MLX high-water mark is the more
important unified-memory signal. The unbounded full-script cases exceeded the
machine's 8 GB physical memory; the 512-token cases stayed below 8 GB but leave
little headroom. No production suitability is claimed from these measurements.

Short preview generation ranged from 4.40 s to 25.53 s, with peak MLX memory
from approximately 4.15 GB to 7.55 GB. `ono_anna` reached the 512-token preview
ceiling and produced a 40.96-second sample; this is a technical audition only,
not evidence of a suitable English narration voice.

## Audio validation

Seventeen WAV files are available. Each passed:

- Python WAV parsing.
- PCM signed 16-bit, mono, 24 kHz checks.
- FFprobe stream inspection.
- Full FFmpeg null-sink decode.

All samples have positive duration and no decoder errors. Measured peak levels
were below 0 dBFS in the final files. Loudness varies materially across voices
and runs, so production loudness normalization would need a separate authorized
experiment. Technical validity does not establish naturalness, pronunciation,
completeness, or expressive quality.

## Human listening package

Samples are in:

```text
m5-narration-experiment/qwen3-tts-experiment/samples/
```

Important files:

```text
voice-preview-*.wav                         # all nine available speakers
m5-neutral-ryan-bounded512.wav              # bounded neutral M5 script
m5-curious-science-explainer-ryan-bounded512.wav
m5-animated-sunset-ryan-bounded512.wav
m5-aiden-warm-explainer-aiden-bounded512.wav
m5-neutral-ryan.wav                         # unbounded comparison
m5-curious-science-explainer-ryan.wav
m5-animated-sunset-ryan.wav
m5-aiden-warm-explainer-aiden.wav
```

Listen for pronunciation of `Rayleigh`, `wavelengths`, and `atmosphere`, exact
script completeness, sentence rhythm, instruction-following, sibilance,
robotic artifacts, clipping or harshness, and fit for a science-explainer
channel. Do not judge a voice from duration or loudness alone.

## Recommendation

Do not integrate Qwen3-TTS into the production bridge yet. The 4-bit checkpoint
is Apple-Silicon compatible and can generate locally, but the observed duration
variance and near-limit memory use require a bounded follow-up design. If the
owner likes a sample, the next experiment should be isolated and should:

1. Select one English-native speaker (`Ryan` or `Aiden`) after listening.
2. Use an explicit token/time ceiling and detect incomplete output.
3. Compare deterministic settings and instruction variants on the same text.
4. Add loudness and duration acceptance checks without altering M5 artifacts.

No audio was automatically approved. No production bridge, canonical M5 media,
production database, paid API, provider request, publication, or provenance
workflow was touched.
