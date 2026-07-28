import pathlib
import subprocess
import unittest
from unittest import mock

from runner import orchestrator


WORKTREE = pathlib.Path("/tmp/worktree")
CHECK = ["npm", "run", "check"]


def failure():
    return subprocess.CalledProcessError(1, CHECK)


class ProductCheckTests(unittest.TestCase):
    def test_a_passing_check_runs_once(self):
        with mock.patch.object(orchestrator, "run") as spawn:
            orchestrator.run_product_check(CHECK, WORKTREE)
        self.assertEqual(spawn.call_count, 1)

    def test_a_timing_flake_is_retried_rather_than_failing_the_run(self):
        with mock.patch.object(orchestrator, "run",
                               side_effect=[failure(), None]) as spawn:
            orchestrator.run_product_check(CHECK, WORKTREE)
        self.assertEqual(spawn.call_count, 2)
        self.assertEqual(spawn.call_args[0][0], CHECK)

    def test_a_genuinely_broken_change_still_fails_the_run(self):
        with mock.patch.object(orchestrator, "run",
                               side_effect=[failure(), failure()]) as spawn:
            with self.assertRaises(subprocess.CalledProcessError):
                orchestrator.run_product_check(CHECK, WORKTREE)
        self.assertEqual(spawn.call_count, 2)


if __name__ == "__main__":
    unittest.main()
