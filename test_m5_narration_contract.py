import tempfile
import unittest
from pathlib import Path

from m5_narration_contract import NarrationRequest, NarrationResult


class NarrationContractTests(unittest.TestCase):
    def test_request_rejects_invalid_speed_and_format(self):
        with self.assertRaises(ValueError):
            NarrationRequest("text", "voice", speed=3).validate()
        with self.assertRaises(ValueError):
            NarrationRequest("text", "voice", output_format="flac").validate()

    def test_result_records_file_identity_and_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "sample.wav"
            path.write_bytes(b"sample-audio")
            request = NarrationRequest("text", "af_heart")
            result = NarrationResult.from_file(
                provider_id="mlx-kokoro",
                model_id="mlx-community/Kokoro-82M-bf16",
                request=request,
                output_path=path,
                mime_type="audio/wav",
                sample_rate=24000,
                channels=1,
                duration_sec=1.0,
                generation_seconds=0.5,
                metadata={"experiment": True},
            )
            result.validate()
            self.assertEqual(result.byte_size, len(b"sample-audio"))
            self.assertEqual(result.voice_id, "af_heart")
            self.assertTrue(result.sha256)


if __name__ == "__main__":
    unittest.main()
