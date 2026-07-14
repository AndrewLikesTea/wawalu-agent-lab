import json
import pathlib
import tempfile
import unittest
from unittest import mock

from runner import layers


class LayerTests(unittest.TestCase):
    def test_owner_directive_is_prioritized_in_manager_prompt(self):
        with mock.patch.object(layers, "qwen_json", return_value={
            "persona": "frontend", "title": "Improve filters", "outcome": "Faster browsing",
            "acceptance_criteria": ["Filters are keyboard accessible", "Tests pass"],
        }) as qwen:
            layers.propose_task("manager", "product", [], pathlib.Path("unused"), "Prioritize search")
        prompt = qwen.call_args.args[0]
        self.assertIn("Highest-priority owner directive:\nPrioritize search", prompt)
        self.assertIn("not permission to violate constraints", prompt)

    def test_directive_becomes_multi_engineer_program(self):
        tasks = [
            {"persona": "backend", "title": "Model posts", "outcome": "Post model exists",
             "acceptance_criteria": ["Model is bounded", "Tests pass"]},
            {"persona": "frontend", "title": "Build feed", "outcome": "Depends on the post model",
             "acceptance_criteria": ["Feed is accessible", "Tests pass"]},
        ]
        with mock.patch.object(layers, "qwen_json", return_value={"tasks": tasks}) as qwen:
            value = layers.propose_directive_plan("Sam", "product", [], "Build social", pathlib.Path("unused"))
        self.assertEqual([task["persona"] for task in value], ["backend", "frontend"])
        self.assertIn("2-6 ordered", qwen.call_args.args[0])
        self.assertIn("overall directive does not need to", qwen.call_args.args[0])

    def test_large_directive_rejects_concentrated_assignment(self):
        tasks = [
            {"persona": persona, "title": f"Task {index}", "outcome": "Useful outcome",
             "acceptance_criteria": ["Behavior works", "Tests pass"]}
            for index, persona in enumerate(["backend", "frontend", "backend", "frontend"], 1)
        ]
        with mock.patch.object(layers, "qwen_json", return_value={"tasks": tasks}):
            with self.assertRaisesRegex(ValueError, "at least three engineers"):
                layers.propose_directive_plan("Sam", "product", [], "Build social", pathlib.Path("unused"))

    def test_assignment_prompt_balances_utilization_without_busywork(self):
        tasks = [
            {"persona": persona, "title": f"Task {index}", "outcome": "Useful outcome",
             "acceptance_criteria": ["Behavior works", "Tests pass"]}
            for index, persona in enumerate(["backend", "frontend", "infrastructure", "staff"], 1)
        ]
        with mock.patch.object(layers, "qwen_json", return_value={"tasks": tasks}) as qwen:
            layers.propose_directive_plan("Sam", "product", ["[Rowan (backend)] API"],
                                          "Build social", pathlib.Path("unused"))
        prompt = qwen.call_args.args[0]
        self.assertIn("recent utilization", prompt)
        self.assertIn("prefer all four", prompt)
        self.assertIn("Do not\ncreate busywork", prompt)

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
