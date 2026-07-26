import datetime as dt
import json
import pathlib
import tempfile
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


if __name__ == "__main__":
    unittest.main()
