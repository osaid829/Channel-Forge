"""Provider-neutral narration contract for local M5 experiments.

This module deliberately does not select or start a provider. The existing
``m5_speech_bridge.py`` and its ``MacOSSayProvider`` remain the production
fallback. Experimental MLX providers can return the same structured result
without changing the MoneyPrinterTurbo or ChannelForge production paths.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping, Protocol


@dataclass(frozen=True)
class NarrationRequest:
    text: str
    voice_id: str
    speed: float = 1.0
    output_format: str = "wav"

    def validate(self) -> None:
        if not self.text.strip():
            raise ValueError("Narration text must not be empty.")
        if not self.voice_id.strip():
            raise ValueError("Narration voice_id must not be empty.")
        if not math.isfinite(self.speed) or not 0.5 <= self.speed <= 2.0:
            raise ValueError("Narration speed must be finite and between 0.5 and 2.0.")
        if self.output_format not in {"wav", "mp3"}:
            raise ValueError("Narration output_format must be wav or mp3.")


@dataclass(frozen=True)
class NarrationResult:
    provider_id: str
    model_id: str
    voice_id: str
    speed: float
    output_path: Path
    mime_type: str
    sample_rate: int
    channels: int
    duration_sec: float
    generation_seconds: float
    byte_size: int
    sha256: str
    metadata: Mapping[str, object] = field(default_factory=dict)

    @classmethod
    def from_file(
        cls,
        *,
        provider_id: str,
        model_id: str,
        request: NarrationRequest,
        output_path: Path,
        mime_type: str,
        sample_rate: int,
        channels: int,
        duration_sec: float,
        generation_seconds: float,
        metadata: Mapping[str, object] | None = None,
    ) -> "NarrationResult":
        payload = output_path.read_bytes()
        return cls(
            provider_id=provider_id,
            model_id=model_id,
            voice_id=request.voice_id,
            speed=request.speed,
            output_path=output_path,
            mime_type=mime_type,
            sample_rate=sample_rate,
            channels=channels,
            duration_sec=duration_sec,
            generation_seconds=generation_seconds,
            byte_size=len(payload),
            sha256=hashlib.sha256(payload).hexdigest(),
            metadata=dict(metadata or {}),
        )

    def validate(self) -> None:
        if not self.provider_id or not self.model_id or not self.voice_id:
            raise ValueError("Narration provider, model, and voice identity are required.")
        if self.sample_rate <= 0 or self.channels <= 0:
            raise ValueError("Narration sample rate and channel count must be positive.")
        if not math.isfinite(self.duration_sec) or self.duration_sec <= 0:
            raise ValueError("Narration duration must be positive.")
        if not math.isfinite(self.generation_seconds) or self.generation_seconds < 0:
            raise ValueError("Narration generation time must be non-negative.")
        if self.byte_size <= 0 or len(self.sha256) != 64:
            raise ValueError("Narration file identity is incomplete.")


class NarrationProvider(Protocol):
    provider_id: str
    model_id: str

    def synthesize(self, request: NarrationRequest, output_path: Path) -> NarrationResult:
        """Generate one immutable local narration sample."""
        ...
