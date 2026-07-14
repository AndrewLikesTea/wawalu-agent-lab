import pathlib
import json
import tempfile
import unittest
from unittest import mock

from runner.delivery import DELIVERY_REQUEST, consume_merge_request, enable_auto_merge


class DeliveryTests(unittest.TestCase):
    def test_worker_can_request_merge_only_for_its_own_branch(self):
        with tempfile.TemporaryDirectory() as tmp:
            worktree = pathlib.Path(tmp)
            request = worktree / DELIVERY_REQUEST
            request.write_text(json.dumps({
                "action": "auto_merge", "branch": "agent/frontend/task", "requested_by": "frontend",
            }))
            self.assertTrue(consume_merge_request(worktree, "frontend", "agent/frontend/task"))
            self.assertFalse(request.exists())

    def test_rejects_request_for_another_branch_and_consumes_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            worktree = pathlib.Path(tmp)
            request = worktree / DELIVERY_REQUEST
            request.write_text(json.dumps({
                "action": "auto_merge", "branch": "main", "requested_by": "frontend",
            }))
            with self.assertRaisesRegex(ValueError, "does not match"):
                consume_merge_request(worktree, "frontend", "agent/frontend/task")
            self.assertFalse(request.exists())

    @mock.patch("runner.delivery.subprocess.run")
    def test_requests_auto_merge_without_bypassing_branch_protection(self, run):
        enable_auto_merge("owner/repo", "agent/frontend/task", "app-token", pathlib.Path("/worktree"))

        command = run.call_args.args[0]
        self.assertEqual(command[:4], ["gh", "pr", "merge", "agent/frontend/task"])
        self.assertIn("--auto", command)
        self.assertIn("--squash", command)
        self.assertNotIn("--admin", command)
        self.assertEqual(run.call_args.kwargs["env"]["GH_TOKEN"], "app-token")
        self.assertTrue(run.call_args.kwargs["check"])


if __name__ == "__main__":
    unittest.main()
