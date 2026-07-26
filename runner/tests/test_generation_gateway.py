import datetime as dt
import json
import pathlib
import tempfile
import time
import unittest
from unittest import mock

from runner.generation_gateway import GenerationGateway
from runner import layers


NOW = dt.datetime(2026, 7, 25, 12, 0, tzinfo=dt.UTC)
PAYLOAD = {"model": "qwen", "prompt": "private prompt", "format": {"type": "object"}}


class GenerationGatewayTests(unittest.TestCase):
    def gateway(self, root, **options):
        return GenerationGateway(
            pathlib.Path(root), now=lambda: NOW, request_id=lambda: "request-1", **options
        )

    def test_enqueue_and_dispatch_persist_result_and_safe_sample(self):
        with tempfile.TemporaryDirectory() as tmp:
            gateway = self.gateway(tmp, sample_rate=1, sample_seed="tests")
            request_id = gateway.enqueue(PAYLOAD, operation="sam_task")
            self.assertEqual(gateway.dispatch_one(lambda payload: {"response": '{"ok":true}'}),
                             request_id)
            result = gateway.result(request_id)
            self.assertEqual(result["attempts"], 1)
            self.assertEqual(result["response"]["response"], '{"ok":true}')
            sample = json.loads((pathlib.Path(tmp) / "samples/request-1.json").read_text())
            self.assertEqual(sample["model"], "qwen")
            self.assertEqual(sample["operation"], "sam_task")
            self.assertNotIn("prompt", sample)
            self.assertNotIn('{"ok":true}', json.dumps(sample))
            self.assertEqual((pathlib.Path(tmp) / "completed/request-1.json").stat().st_mode & 0o777, 0o600)

    def test_failed_dispatch_rolls_back_for_retry_then_dead_letters(self):
        with tempfile.TemporaryDirectory() as tmp:
            gateway = self.gateway(tmp, max_attempts=2)
            gateway.enqueue(PAYLOAD, operation="sam_task")
            with self.assertRaisesRegex(RuntimeError, "offline"):
                gateway.dispatch_one(lambda payload: (_ for _ in ()).throw(RuntimeError("offline")))
            retry = json.loads((pathlib.Path(tmp) / "pending/request-1.json").read_text())
            self.assertEqual(retry["attempts"], 1)
            self.assertEqual(retry["last_error"], "RuntimeError")
            with self.assertRaises(RuntimeError):
                gateway.dispatch_one(lambda payload: (_ for _ in ()).throw(RuntimeError("offline")))
            self.assertFalse((pathlib.Path(tmp) / "pending/request-1.json").exists())
            self.assertTrue((pathlib.Path(tmp) / "failed/request-1.json").exists())

    def test_abandoned_claim_is_recovered_and_sampling_is_deterministic(self):
        with tempfile.TemporaryDirectory() as tmp:
            gateway = self.gateway(tmp, sample_rate=0.5, sample_seed="stable")
            gateway.enqueue(PAYLOAD, operation="sam_task")
            pending = pathlib.Path(tmp) / "pending/request-1.json"
            pending.replace(pathlib.Path(tmp) / "inflight/request-1.json")
            self.assertEqual(gateway.recover_inflight(), 1)
            gateway.dispatch_one(lambda payload: {"response": "answer"})
            first = (pathlib.Path(tmp) / "samples/request-1.json").exists()

        with tempfile.TemporaryDirectory() as tmp:
            gateway = self.gateway(tmp, sample_rate=0.5, sample_seed="stable")
            gateway.enqueue(PAYLOAD, operation="sam_task")
            gateway.dispatch_one(lambda payload: {"response": "answer"})
            self.assertEqual((pathlib.Path(tmp) / "samples/request-1.json").exists(), first)

    def test_planner_uses_codex_instead_of_the_qwen_gateway(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = pathlib.Path(tmp) / "output.json"
            def codex_result(*_args, **_kwargs):
                output.write_text('{"value":"ok"}')
                return mock.Mock(returncode=0, stdout="", stderr="")

            with mock.patch.object(layers.subprocess, "run", side_effect=codex_result) as run:
                self.assertEqual(layers.qwen_json("prompt", output, {"type": "object"}),
                                 {"value": "ok"})
                self.assertFalse((pathlib.Path(tmp) / "spool").exists())
                self.assertIn("codex", run.call_args.args[0])

    def test_planner_asks_a_quota_exhausted_provider_last(self):
        layers._planner_capacity.clear()
        self.addCleanup(layers._planner_capacity.clear)
        with tempfile.TemporaryDirectory() as tmp:
            output = pathlib.Path(tmp) / "output.json"
            calls: list[str] = []

            def result(command, *_args, **_kwargs):
                calls.append(command[0])
                if command[0] == "codex":
                    return mock.Mock(returncode=1, stdout="",
                                     stderr="ERROR: You've hit your usage limit.")
                return mock.Mock(returncode=0, stdout='{"value":"ok"}', stderr="")

            with mock.patch.object(layers.subprocess, "run", side_effect=result):
                self.assertEqual(layers.qwen_json("prompt", output, {"type": "object"}),
                                 {"value": "ok"})
                self.assertEqual(calls, ["codex", "claude"])
                # The capped provider must not cost a doomed attempt on every tick.
                calls.clear()
                self.assertEqual(layers.qwen_json("prompt", output, {"type": "object"}),
                                 {"value": "ok"})
                self.assertEqual(calls, ["claude"])

    def test_planner_still_tries_everyone_when_all_are_cooling_down(self):
        layers._planner_capacity.clear()
        self.addCleanup(layers._planner_capacity.clear)
        layers.note_planner_capacity("codex")
        layers.note_planner_capacity("claude")
        self.assertEqual(sorted(layers.planner_order(["codex", "claude"])), ["claude", "codex"])

    def test_planner_reconsiders_a_provider_once_its_cooldown_lapses(self):
        layers._planner_capacity.clear()
        self.addCleanup(layers._planner_capacity.clear)
        layers.note_planner_capacity("codex", now=time.time() - layers.PLANNER_CAPACITY_COOLDOWN_SECONDS - 1)
        self.assertEqual(layers.planner_order(["codex", "claude"]), ["codex", "claude"])


if __name__ == "__main__":
    unittest.main()
