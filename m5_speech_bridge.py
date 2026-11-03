"""M5-only localhost speech bridge; importing this module performs no I/O.

Actual narrator: macOS Samantha (English (US)), NOT Kokoro or af_heart.
The existing MoneyPrinterTurbo transport may send model=kokoro/voice=af_heart;
those are explicit compatibility aliases, not claims about the audio provider.

Running this file explicitly starts one server on 127.0.0.1:8880. Synthesis
starts only on POST /v1/audio/speech. No packages, voices, or models are installed.
One distinct narration is allowed per server lifetime. Identical requests reuse
the in-memory MP3; failed synthesis is remembered and never automatically retried.
Restarting clears that state. A production driver must obtain authorization before
restarting to retry a failed or uncertain operation.

The SpeechProvider protocol is the replacement boundary for a future narrator.
ChannelForge's production adapter and canonical job workflow are not changed.
"""

from __future__ import annotations

import hashlib
import json
import math
import socket
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Protocol


WORKSPACE = Path("/Users/osaid/Documents/ChannelForge")
BIND_ADDRESS = ("127.0.0.1", 8880)
MAX_BODY_BYTES = 8192
MAX_TEXT_CHARS = 1200
MAX_WORDS = 80
MAX_MP3_BYTES = 2 * 1024 * 1024
IO_TIMEOUT = 5.0
SAY_TIMEOUT = 30
FFMPEG_TIMEOUT = 20


class SpeechError(Exception):
    """Safe, fixed error text suitable for returning to a localhost client."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class SpeechInput:
    text: str
    speed: float


class SpeechProvider(Protocol):
    provider_id: str
    model_id: str
    voice_id: str
    display_name: str

    def synthesize(self, request: SpeechInput) -> bytes:
        """Return MP3 bytes or raise; implement bounded local execution."""
        ...


class MacOSSayProvider:
    provider_id = "macos-say"
    model_id = "macos-samantha"
    voice_id = "macos-samantha"
    display_name = "macOS Samantha (English (US))"

    def __init__(self, workspace: Path = WORKSPACE):
        self.workspace = workspace

    def synthesize(self, request: SpeechInput) -> bytes:
        # TemporaryDirectory is private (0700); all explicit audio paths remain
        # inside the workspace, outside MoneyPrinterTurbo's public/task mounts.
        try:
            with tempfile.TemporaryDirectory(
                prefix=".m5-speech-", dir=self.workspace
            ) as directory:
                aiff = Path(directory) / "narration.aiff"
                mp3 = Path(directory) / "narration.mp3"
                subprocess.run(
                    [
                        "/usr/bin/say", "-v", "Samantha (English (US))",
                        "-r", str(round(150 * request.speed)), "-o", str(aiff),
                    ],
                    input=request.text,
                    encoding="utf-8",
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=SAY_TIMEOUT,
                    shell=False,
                )
                subprocess.run(
                    [
                        "/opt/homebrew/bin/ffmpeg", "-nostdin", "-hide_banner",
                        "-loglevel", "error", "-y", "-threads", "1",
                        "-i", str(aiff), "-map", "0:a:0", "-vn",
                        "-map_metadata", "-1", "-ac", "1", "-ar", "24000",
                        "-c:a", "libmp3lame", "-b:a", "64k", "-threads", "1",
                        "-filter_threads", "1", str(mp3),
                    ],
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=True,
                    timeout=FFMPEG_TIMEOUT,
                    shell=False,
                )
                size = mp3.stat().st_size
                if not 0 < size <= MAX_MP3_BYTES:
                    raise SpeechError(502, "Speech output is empty or too large.")
                return mp3.read_bytes()
        except subprocess.TimeoutExpired:
            raise SpeechError(504, "Local speech processing timed out.") from None
        except (OSError, subprocess.CalledProcessError):
            raise SpeechError(502, "Local speech processing failed.") from None


class SpeechService:
    """Provider-neutral validation, serialization, and single-narration cache."""

    def __init__(
        self,
        provider: SpeechProvider,
        *,
        model_aliases: tuple[str, ...] = (),
        voice_aliases: tuple[str, ...] = (),
    ):
        self.provider = provider
        self.models = (provider.model_id, *model_aliases)
        self.voices = (provider.voice_id, *voice_aliases)
        self._lock = threading.Lock()
        self._identity: str | None = None
        self._audio: bytes | None = None
        self._failure: tuple[int, str] | None = None

    def metadata(self) -> dict:
        return {
            "provider": self.provider.provider_id,
            "model": self.provider.model_id,
            "voice": self.provider.voice_id,
            "display_name": self.provider.display_name,
            "accepted_model_aliases": list(self.models[1:]),
            "accepted_voice_aliases": list(self.voices[1:]),
        }

    def parse(self, body: bytes) -> SpeechInput:
        if len(body) > MAX_BODY_BYTES:
            raise SpeechError(413, "Request body is too large.")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeError, RecursionError):
            raise SpeechError(400, "Invalid JSON request.") from None
        if not isinstance(payload, dict):
            raise SpeechError(400, "Expected a JSON object.")
        if set(payload) - {"model", "voice", "input", "speed", "response_format"}:
            raise SpeechError(400, "Unsupported speech request fields.")
        if payload.get("model") not in self.models:
            raise SpeechError(400, "Unsupported model.")
        if payload.get("voice") not in self.voices:
            raise SpeechError(400, "Unsupported voice.")
        if payload.get("response_format", "mp3") != "mp3":
            raise SpeechError(400, "Only MP3 output is supported.")
        text = payload.get("input")
        if not isinstance(text, str):
            raise SpeechError(400, "Speech input must be text.")
        text = text.strip()
        if (
            not text or len(text) > MAX_TEXT_CHARS
            or len(text.split()) > MAX_WORDS
            or not any(character.isalnum() for character in text)
            or any(ord(character) < 32 and character not in "\n\t" for character in text)
            # macOS say recognizes embedded speech-control commands. M5 accepts
            # plain narration only, preventing changes to the selected voice.
            or "[[" in text or "]]" in text
        ):
            raise SpeechError(400, "Input must be bounded, plain narration text.")
        speed = payload.get("speed", 1.0)
        if (
            isinstance(speed, bool) or not isinstance(speed, (int, float))
            or not 0.75 <= speed <= 1.5
        ):
            raise SpeechError(400, "Speed must be between 0.75 and 1.5.")
        if not math.isfinite(speed):
            raise SpeechError(400, "Speed must be finite.")
        return SpeechInput(text, float(speed))

    def speech(self, body: bytes) -> tuple[bytes, bool]:
        request = self.parse(body)
        identity = hashlib.sha256(
            json.dumps([request.text, request.speed], ensure_ascii=True).encode("ascii")
        ).hexdigest()
        with self._lock:
            if self._identity is not None:
                if self._identity != identity:
                    raise SpeechError(409, "This session is reserved for one narration.")
                if self._failure is not None:
                    raise SpeechError(*self._failure)
                if self._audio is not None:
                    return self._audio, True
                raise SpeechError(503, "Previous synthesis outcome is uncertain.")
            # Reserve BEFORE synthesis. A failure must never cause automatic replay.
            self._identity = identity
            try:
                audio = self.provider.synthesize(request)
                if not isinstance(audio, bytes) or not 0 < len(audio) <= MAX_MP3_BYTES:
                    raise SpeechError(502, "Invalid provider audio output.")
                self._audio = audio
                return audio, False
            except SpeechError as error:
                self._failure = (error.status, str(error))
                raise
            except Exception:
                self._failure = (502, "Speech provider failed; automatic retry disabled.")
                raise SpeechError(*self._failure) from None


class SpeechHTTPServer(HTTPServer):
    # Intentionally not ThreadingHTTPServer: only one HTTP/synthesis task at once.
    request_queue_size = 1
    allow_reuse_address = False

    def __init__(self, service: SpeechService):
        self.service = service
        super().__init__(BIND_ADDRESS, SpeechHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(IO_TIMEOUT)
        return connection, address

    def handle_error(self, request, client_address):
        # No request contents, credentials, or exception text enter service logs.
        print("Speech bridge: request handling failed.", flush=True)


class SpeechHandler(BaseHTTPRequestHandler):
    server_version = "ChannelForgeM5Speech/1"
    sys_version = ""

    def log_message(self, format, *args):
        pass

    def _reply(self, status: int, body: bytes, content_type: str, *, cached=False):
        self.close_connection = True
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Speech-Provider", self.server.service.provider.provider_id)
            self.send_header("X-Speech-Voice", self.server.service.provider.display_name)
            self.send_header("X-Speech-Cache", "hit" if cached else "miss")
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            # Successful audio stays cached if the client disconnects.
            pass

    def _json(self, status: int, payload: dict):
        self._reply(status, json.dumps(payload).encode("utf-8"), "application/json")

    def _check_origin(self):
        # No browser integration is needed for this local service-to-service bridge.
        if self.headers.get("Origin") is not None:
            raise SpeechError(403, "Browser-origin requests are not supported.")
        if self.headers.get("Host") not in ("127.0.0.1:8880", "localhost:8880"):
            raise SpeechError(400, "Expected the localhost speech endpoint.")

    def do_GET(self):
        try:
            self._check_origin()
            metadata = self.server.service.metadata()
            if self.path == "/v1/models":
                self._json(200, {
                    "object": "list",
                    "data": [{"id": metadata["model"], "object": "model", **metadata}],
                })
            elif self.path == "/v1/audio/voices":
                self._json(200, {"voices": [metadata["voice"]], **metadata})
            else:
                raise SpeechError(404, "Endpoint not found.")
        except SpeechError as error:
            self._json(error.status, {"error": {"message": str(error)}})

    def _read_body(self) -> bytes:
        if self.headers.get("Transfer-Encoding") is not None:
            raise SpeechError(400, "Transfer encoding is not supported.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1:
            raise SpeechError(411, "One Content-Length header is required.")
        if not lengths[0].isascii() or not lengths[0].isdigit():
            raise SpeechError(400, "Invalid Content-Length.")
        if len(lengths[0]) > 8:
            raise SpeechError(413, "Request body is too large.")
        length = int(lengths[0])
        if not 0 < length <= MAX_BODY_BYTES:
            raise SpeechError(413, "Request body is empty or too large.")
        if self.headers.get_content_type() != "application/json":
            raise SpeechError(415, "Expected application/json.")
        chunks = []
        remaining = length
        deadline = time.monotonic() + IO_TIMEOUT
        try:
            while remaining:
                budget = deadline - time.monotonic()
                if budget <= 0:
                    raise SpeechError(408, "Request body timed out.")
                self.connection.settimeout(budget)
                chunk = self.rfile.read1(remaining)
                if not chunk:
                    raise SpeechError(400, "Incomplete request body.")
                chunks.append(chunk)
                remaining -= len(chunk)
        except (socket.timeout, OSError):
            raise SpeechError(408, "Request body could not be read in time.") from None
        finally:
            self.connection.settimeout(IO_TIMEOUT)
        return b"".join(chunks)

    def do_POST(self):
        try:
            self._check_origin()
            if self.path != "/v1/audio/speech":
                raise SpeechError(404, "Endpoint not found.")
            audio, cached = self.server.service.speech(self._read_body())
            self._reply(200, audio, "audio/mpeg", cached=cached)
        except SpeechError as error:
            self._json(error.status, {"error": {"message": str(error)}})


def main() -> None:
    service = SpeechService(
        MacOSSayProvider(), model_aliases=("kokoro",), voice_aliases=("af_heart",)
    )
    try:
        with SpeechHTTPServer(service) as server:
            print(
                "M5 speech bridge on http://127.0.0.1:8880; actual narrator: "
                "macOS Samantha (English (US)). kokoro/af_heart are transport "
                "aliases only. One distinct narration per session.",
                flush=True,
            )
            try:
                server.serve_forever(poll_interval=0.25)
            except KeyboardInterrupt:
                pass
    except OSError:
        raise SystemExit("Speech bridge could not bind its localhost port.") from None


if __name__ == "__main__":
    main()
