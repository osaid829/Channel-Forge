"""Offline unit tests; synthetic bytes below are NOT real production audio.

Tests never start an HTTP listener, invoke macOS speech/FFmpeg, or use a network.
Execution requires separate authorization. Any temporary fixtures stay inside
the ChannelForge workspace and are removed by their context managers.
"""

import io
import json
import subprocess
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from email.message import Message
from pathlib import Path
from unittest.mock import Mock, patch

from m5_speech_bridge import (
    BIND_ADDRESS, FFMPEG_TIMEOUT, MAX_BODY_BYTES, SAY_TIMEOUT, WORKSPACE,
    MacOSSayProvider, SpeechError, SpeechHandler, SpeechInput, SpeechService,
)


class FakeProvider:
    provider_id = "test-only-provider"
    model_id = "test-model"
    voice_id = "test-voice"
    display_name = "Synthetic unit-test fixture, not narration"

    def __init__(self):
        self.synthesize = Mock(return_value=b"synthetic-test-fixture-not-an-mp3")


def request_body(**overrides):
    payload = {
        "model": "kokoro", "voice": "af_heart", "input": "Why is the sky blue?",
        "speed": 1.0, "response_format": "mp3",
    }
    payload.update(overrides)
    return json.dumps(payload).encode("utf-8")


def make_service(provider=None):
    return SpeechService(
        provider or FakeProvider(),
        model_aliases=("kokoro",), voice_aliases=("af_heart",),
    )


class ServiceTests(unittest.TestCase):
    def test_transport_aliases_preserve_actual_identity(self):
        service = make_service(MacOSSayProvider())
        metadata = service.metadata()
        self.assertEqual(metadata["provider"], "macos-say")
        self.assertEqual(metadata["voice"], "macos-samantha")
        self.assertIn("Samantha", metadata["display_name"])
        self.assertEqual(metadata["accepted_voice_aliases"], ["af_heart"])
        self.assertEqual(service.parse(request_body()).speed, 1.0)

    def test_invalid_requests_never_invoke_provider(self):
        service = make_service()
        invalid = [
            b"null", b"[]", b"{", b"\xff", b"x" * (MAX_BODY_BYTES + 1),
            request_body(input=""), request_body(input="..."),
            request_body(input="word " * 81), request_body(input="a" * 1201),
            request_body(input="hello\x00world"),
            request_body(input="[[rate 900]]hello"),
            request_body(model="other"), request_body(voice="other"),
            request_body(response_format="wav"), request_body(stream=True),
            request_body(speed=True), request_body(speed="1"),
            request_body(speed=0.25), request_body(speed=4),
            request_body(speed=float("nan")), request_body(speed=float("inf")),
        ]
        for body in invalid:
            with self.subTest(body=body[:80]), self.assertRaises(SpeechError):
                service.speech(body)
        service.provider.synthesize.assert_not_called()

    def test_equivalent_alias_requests_reuse_audio(self):
        service = make_service()
        audio, cached = service.speech(request_body())
        self.assertFalse(cached)
        repeat, cached = service.speech(
            request_body(model="test-model", voice="test-voice", speed=1)
        )
        self.assertTrue(cached)
        self.assertEqual(repeat, audio)
        service.provider.synthesize.assert_called_once_with(
            SpeechInput("Why is the sky blue?", 1.0)
        )

    def test_different_narration_does_not_trigger_second_synthesis(self):
        service = make_service()
        service.speech(request_body())
        with self.assertRaises(SpeechError) as error:
            service.speech(request_body(input="A different script."))
        self.assertEqual(error.exception.status, 409)
        service.provider.synthesize.assert_called_once()

    def test_provider_failure_is_safe_and_never_replayed(self):
        for failure in (
            RuntimeError("private subprocess details"),
            SpeechError(504, "Local speech processing timed out."),
        ):
            with self.subTest(failure=type(failure).__name__):
                service = make_service()
                service.provider.synthesize.side_effect = failure
                for _ in range(2):
                    with self.assertRaises(SpeechError) as error:
                        service.speech(request_body())
                    self.assertNotIn("private", str(error.exception))
                service.provider.synthesize.assert_called_once()

    def test_empty_output_is_rejected_and_not_replayed(self):
        service = make_service()
        service.provider.synthesize.return_value = b""
        for _ in range(2):
            with self.assertRaises(SpeechError):
                service.speech(request_body())
        service.provider.synthesize.assert_called_once()

    def test_concurrent_requests_share_one_synthesis(self):
        service = make_service()
        entered = threading.Event()
        release = threading.Event()

        def synthesize(_):
            entered.set()
            if not release.wait(2):
                raise RuntimeError("test synchronization timed out")
            return b"synthetic-fixture"

        service.provider.synthesize.side_effect = synthesize
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(service.speech, request_body())
            try:
                self.assertTrue(entered.wait(2))
                second = executor.submit(service.speech, request_body())
            finally:
                release.set()
            results = [first.result(timeout=3), second.result(timeout=3)]
        self.assertEqual(sorted(cached for _, cached in results), [False, True])
        service.provider.synthesize.assert_called_once()


class MacOSProviderTests(unittest.TestCase):
    def test_bounded_argv_commands_and_private_cleanup(self):
        with tempfile.TemporaryDirectory(prefix=".m5-test-", dir=WORKSPACE) as folder:
            workspace = Path(folder)

            def fake_run(argv, **kwargs):
                self.assertFalse(kwargs["shell"])
                self.assertTrue(kwargs["check"])
                if argv[0] == "/usr/bin/say":
                    self.assertEqual(kwargs["timeout"], SAY_TIMEOUT)
                    self.assertEqual(kwargs["input"], "Hello; $(not-a-command)")
                    self.assertNotIn(kwargs["input"], argv)
                    self.assertIn("Samantha (English (US))", argv)
                    self.assertEqual(argv[argv.index("-r") + 1], "150")
                    output = Path(argv[argv.index("-o") + 1])
                else:
                    self.assertEqual(argv[0], "/opt/homebrew/bin/ffmpeg")
                    self.assertEqual(kwargs["timeout"], FFMPEG_TIMEOUT)
                    self.assertEqual(argv[argv.index("-threads") + 1], "1")
                    output = Path(argv[-1])
                self.assertTrue(output.is_relative_to(workspace))
                self.assertEqual(output.parent.stat().st_mode & 0o777, 0o700)
                output.write_bytes(b"synthetic-test-fixture")

            with patch("m5_speech_bridge.subprocess.run", side_effect=fake_run) as run:
                result = MacOSSayProvider(workspace).synthesize(
                    SpeechInput("Hello; $(not-a-command)", 1.0)
                )
            self.assertEqual(result, b"synthetic-test-fixture")
            self.assertEqual(run.call_count, 2)
            self.assertEqual(list(workspace.iterdir()), [])

    def test_subprocess_errors_cleanup_and_do_not_leak_details(self):
        failures = [
            subprocess.TimeoutExpired(["private-argument"], 30),
            subprocess.CalledProcessError(1, ["private-argument"]),
            FileNotFoundError("private-path"),
        ]
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                with tempfile.TemporaryDirectory(prefix=".m5-test-", dir=WORKSPACE) as folder:
                    with patch("m5_speech_bridge.subprocess.run", side_effect=failure):
                        with self.assertRaises(SpeechError) as error:
                            MacOSSayProvider(Path(folder)).synthesize(SpeechInput("Hello", 1))
                    self.assertNotIn("private", str(error.exception))
                    self.assertEqual(list(Path(folder).iterdir()), [])


class HTTPContractTests(unittest.TestCase):
    def handler(self, body=None):
        # Construct a handler without a socket, HTTPServer, or network activity.
        handler = object.__new__(SpeechHandler)
        handler.server = Mock(service=make_service())
        handler.connection = Mock()
        handler.headers = Message()
        handler.headers["Host"] = "127.0.0.1:8880"
        handler.headers["Content-Type"] = "application/json"
        body = request_body() if body is None else body
        handler.headers["Content-Length"] = str(len(body))
        handler.rfile = io.BufferedReader(io.BytesIO(body))
        handler.wfile = io.BytesIO()
        handler.send_response = Mock()
        handler.send_header = Mock()
        handler.end_headers = Mock()
        handler.path = "/v1/audio/speech"
        self.addCleanup(handler.rfile.close)
        self.addCleanup(handler.wfile.close)
        return handler

    def test_fixed_loopback_and_mp3_contract(self):
        self.assertEqual(BIND_ADDRESS, ("127.0.0.1", 8880))
        handler = self.handler()
        handler.do_POST()
        handler.send_response.assert_called_once_with(200)
        handler.send_header.assert_any_call("Content-Type", "audio/mpeg")
        handler.send_header.assert_any_call("X-Speech-Provider", "test-only-provider")
        self.assertEqual(handler.wfile.getvalue(), b"synthetic-test-fixture-not-an-mp3")

    def test_framing_origin_and_size_fail_before_synthesis(self):
        cases = [
            ("Transfer-Encoding", "chunked", 400),
            ("Content-Length", str(MAX_BODY_BYTES + 1), 413),
            ("Content-Length", "invalid", 400),
            ("Content-Type", "text/plain", 415),
            ("Origin", "http://example.invalid", 403),
            ("Host", "example.invalid:8880", 400),
        ]
        for name, value, expected in cases:
            with self.subTest(header=name):
                handler = self.handler()
                if name in handler.headers:
                    del handler.headers[name]
                handler.headers[name] = value
                handler.do_POST()
                handler.send_response.assert_called_once_with(expected)
                handler.server.service.provider.synthesize.assert_not_called()

    def test_duplicate_length_and_truncated_body_rejected(self):
        for duplicate in (True, False):
            handler = self.handler()
            if duplicate:
                handler.headers["Content-Length"] = "1"
            else:
                handler.headers.replace_header("Content-Length", "8000")
            handler.do_POST()
            handler.send_response.assert_called_once_with(411 if duplicate else 400)
            handler.server.service.provider.synthesize.assert_not_called()

    def test_model_discovery_is_honest_and_does_not_synthesize(self):
        handler = self.handler()
        handler.server.service = make_service(MacOSSayProvider())
        handler.path = "/v1/models"
        handler.do_GET()
        payload = json.loads(handler.wfile.getvalue())
        self.assertEqual(payload["data"][0]["id"], "macos-samantha")
        self.assertEqual(payload["data"][0]["accepted_model_aliases"], ["kokoro"])


if __name__ == "__main__":
    unittest.main()
