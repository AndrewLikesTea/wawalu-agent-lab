import json
import pathlib
import tempfile
import unittest
from unittest import mock

from runner import layers


class LayerTests(unittest.TestCase):
    def test_requested_worker_overrides_qwen_choice(self):
        with mock.patch.object(layers, "qwen_json", return_value={
            "worker": "claude", "task_prompt": "Implement the issue", "rationale": "test"
        }):
            value = layers.plan("persona", {"outcome": "x"}, pathlib.Path("unused"), "codex")
        self.assertEqual(value["worker"], "codex")

    def test_claude_telemetry_uses_persona_token_not_provider_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = layers.prepare_claude_settings(pathlib.Path(tmp), "persona-token", "https://example.invalid")
            settings = json.loads(path.read_text())
        env = settings["env"]
        self.assertEqual(env["OTEL_EXPORTER_OTLP_HEADERS"], "Authorization=Bearer persona-token")
        self.assertEqual(env["OTEL_EXPORTER_OTLP_PROTOCOL"], "http/json")
        self.assertEqual(env["OTEL_LOGS_EXPORT_INTERVAL"], "1000")
        self.assertNotIn("email", json.dumps(settings).lower())

    def test_codex_telemetry_uses_persona_token_and_isolated_auth(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            fake_home = root / "home"
            (fake_home / ".codex").mkdir(parents=True)
            (fake_home / ".codex" / "auth.json").write_text('{"auth":"provider-account"}')
            with mock.patch("pathlib.Path.home", return_value=fake_home):
                home, callback = layers.prepare_codex_home(
                    root / "repo", "frontend", "persona-token",
                    "https://example.invalid", root / "missing-notify")
            config = (home / "config.toml").read_text()
            callback_value = json.loads(callback.read_text())
        self.assertIn("Bearer persona-token", config)
        self.assertEqual(callback_value["token"], "persona-token")
        self.assertNotIn("provider-account", config)


if __name__ == "__main__":
    unittest.main()
