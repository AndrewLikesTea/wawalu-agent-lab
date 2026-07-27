import pathlib
import subprocess
import unittest
from unittest import mock

from runner import orchestrator


WORKTREE = pathlib.Path("/tmp/worktree")
BRANCH = "agent/backend/issue-93-post-images"


def completed(command, returncode):
    return subprocess.CompletedProcess(command, returncode)


class PushBranchTests(unittest.TestCase):
    def test_clean_push_needs_no_force(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["git", "push"], 0)) as spawn:
            orchestrator.push_branch(BRANCH, WORKTREE, {})
        self.assertEqual(spawn.call_count, 1)
        self.assertNotIn("--force-with-lease", " ".join(spawn.call_args[0][0]))

    def test_branch_left_by_an_earlier_attempt_is_replaced_under_lease(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["git", "push"], 1)), \
             mock.patch.object(orchestrator, "output", return_value=f"deadbeef\trefs/heads/{BRANCH}"), \
             mock.patch.object(orchestrator, "run") as forced:
            orchestrator.push_branch(BRANCH, WORKTREE, {})
        self.assertIn(f"--force-with-lease={BRANCH}:deadbeef", forced.call_args[0][0])

    def test_push_failure_with_no_remote_branch_still_fails_the_run(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["git", "push"], 1)), \
             mock.patch.object(orchestrator, "output", return_value=""), \
             mock.patch.object(orchestrator, "run") as forced:
            with self.assertRaisesRegex(RuntimeError, "no remote branch"):
                orchestrator.push_branch(BRANCH, WORKTREE, {})
        forced.assert_not_called()


class CreatePullRequestTests(unittest.TestCase):
    def test_first_attempt_opens_the_pull_request(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["gh"], 0)) as spawn, \
             mock.patch.object(orchestrator, "output") as listed:
            orchestrator.create_pull_request(["gh", "pr", "create"], BRANCH, WORKTREE, {})
        self.assertEqual(spawn.call_count, 1)
        listed.assert_not_called()

    def test_duplicate_head_reuses_the_open_pull_request(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["gh"], 1)), \
             mock.patch.object(orchestrator, "output", return_value="103"):
            orchestrator.create_pull_request(["gh", "pr", "create"], BRANCH, WORKTREE, {})

    def test_create_failure_with_no_open_pull_request_fails_the_run(self):
        with mock.patch.object(orchestrator.subprocess, "run",
                               return_value=completed(["gh"], 1)), \
             mock.patch.object(orchestrator, "output", return_value=""):
            with self.assertRaisesRegex(RuntimeError, "none is open"):
                orchestrator.create_pull_request(["gh", "pr", "create"], BRANCH, WORKTREE, {})


class OptionalReviewDebateTests(unittest.TestCase):
    """The debate is narrative only, so it must never fail an already-approved run."""

    def test_successful_debate_is_recorded(self):
        debate = {"messages": [], "resolution": "ship it"}
        metadata = {}
        with mock.patch.object(orchestrator, "review_debate", return_value=debate):
            value = orchestrator.optional_review_debate({}, {}, "", WORKTREE / "d.json", metadata)
        self.assertEqual(value, debate)
        self.assertEqual(metadata["review_debate"], debate)
        self.assertNotIn("review_debate_error", metadata)

    def test_planner_json_failure_leaves_the_run_alive(self):
        metadata = {}
        with mock.patch.object(orchestrator, "review_debate",
                               side_effect=RuntimeError("frontier planner failed; bad JSON")):
            value = orchestrator.optional_review_debate({}, {}, "", WORKTREE / "d.json", metadata)
        self.assertIsNone(value)
        self.assertIn("frontier planner failed", metadata["review_debate_error"])
        self.assertNotIn("review_debate", metadata)

    def test_planner_capacity_exhaustion_does_not_defer_shipped_work(self):
        metadata = {}
        with mock.patch.object(orchestrator, "review_debate",
                               side_effect=orchestrator.PlannerCapacityExhausted("codex", "capped")):
            value = orchestrator.optional_review_debate({}, {}, "", WORKTREE / "d.json", metadata)
        self.assertIsNone(value)
        self.assertIn("PlannerCapacityExhausted", metadata["review_debate_error"])

    def test_planner_timeout_leaves_the_run_alive(self):
        metadata = {}
        with mock.patch.object(orchestrator, "review_debate",
                               side_effect=subprocess.TimeoutExpired(["codex"], 900)):
            value = orchestrator.optional_review_debate({}, {}, "", WORKTREE / "d.json", metadata)
        self.assertIsNone(value)
        self.assertIn("TimeoutExpired", metadata["review_debate_error"])


if __name__ == "__main__":
    unittest.main()
