import pathlib
import unittest
from unittest import mock

from runner.delivery import enable_auto_merge


class DeliveryTests(unittest.TestCase):
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
