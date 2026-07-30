import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

from runner import autonomous, orchestrator


CHECK = ["npm", "run", "check"]


def failure(stdout: str = "", stderr: str = ""):
    return subprocess.CalledProcessError(1, CHECK, output=stdout, stderr=stderr)


class CheckFailureTextTests(unittest.TestCase):
    def test_both_streams_are_kept(self):
        text = orchestrator.check_failure_text(
            failure(stdout="not ok 12 - export parity", stderr="1 test failed"))
        self.assertIn("not ok 12 - export parity", text)
        self.assertIn("1 test failed", text)

    def test_a_silent_failure_still_says_what_ran(self):
        self.assertIn("npm run check", orchestrator.check_failure_text(failure()))

    def test_a_long_check_log_is_trimmed_to_its_tail(self):
        text = orchestrator.check_failure_text(
            failure(stdout="head-noise\n" + "x" * 9000 + "\nnot ok 3 - the real failure"),
            limit=200)
        self.assertLessEqual(len(text), 210)
        self.assertIn("not ok 3 - the real failure", text)
        self.assertNotIn("head-noise", text)


class CheckFailureFeedbackTests(unittest.TestCase):
    def setUp(self):
        self.runs = pathlib.Path(tempfile.mkdtemp())
        patcher = mock.patch.object(autonomous, "ROOT", self.runs)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.run_dir = self.runs / ".agent" / "runs" / "sim_1"
        self.run_dir.mkdir(parents=True)

    def test_the_check_output_reaches_the_retry(self):
        (self.run_dir / orchestrator.CHECK_FAILURE_FILE).write_text(
            "not ok 4 - ALLOWED_MODULES is missing finops-trajectory\n", encoding="utf-8")
        feedback = autonomous.latest_run_check_failure()
        self.assertIn("ALLOWED_MODULES is missing finops-trajectory", feedback)
        self.assertIn("npm run check", feedback)

    def test_a_run_that_never_reached_the_check_carries_nothing(self):
        self.assertEqual(autonomous.latest_run_check_failure(), "")


if __name__ == "__main__":
    unittest.main()
