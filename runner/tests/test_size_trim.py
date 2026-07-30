import pathlib
import unittest
from unittest import mock

from runner import orchestrator


WORKTREE = pathlib.Path("/tmp/worktree")
BASE = "abc1234"


class OversizedOnlyTests(unittest.TestCase):
    """The trim pass is only ever a remedy for the changed-line ceiling."""

    def test_a_lone_size_complaint_is_trimmable(self):
        self.assertTrue(orchestrator.oversized_only(
            "policy: 2157 changed lines exceeds limit 2000"))

    def test_a_forbidden_path_is_not_trimmable(self):
        self.assertFalse(orchestrator.oversized_only(
            "policy: forbidden path changed: runner/autonomous.py"))

    def test_a_size_complaint_alongside_a_forbidden_path_is_not_trimmable(self):
        # Trimming lines would clear one reason and leave the other, so the run has
        # to be rejected whole rather than paying for a session that cannot pass.
        self.assertFalse(orchestrator.oversized_only(
            "policy: 2157 changed lines exceeds limit 2000\n"
            "policy: forbidden path changed: .secrets/runtime.env"))

    def test_a_file_count_complaint_is_not_trimmable(self):
        self.assertFalse(orchestrator.oversized_only(
            "policy: 34 files exceeds limit 30"))

    def test_no_complaint_is_not_trimmable(self):
        self.assertFalse(orchestrator.oversized_only(""))


class ChangedLineCountTests(unittest.TestCase):
    """Counted the way runner.policy counts, so the trim aims at the real number."""

    def test_committed_unstaged_and_staged_lines_all_count(self):
        with mock.patch.object(orchestrator, "output",
                               side_effect=["10\t5\tone.js", "3\t1\ttwo.js",
                                            "2\t0\tthree.js"]):
            self.assertEqual(orchestrator.changed_line_count(WORKTREE, BASE), 21)

    def test_binary_files_report_dashes_and_are_skipped(self):
        with mock.patch.object(orchestrator, "output",
                               side_effect=["-\t-\tlogo.png", "4\t2\tapp.js", ""]):
            self.assertEqual(orchestrator.changed_line_count(WORKTREE, BASE), 6)

    def test_an_untouched_worktree_counts_nothing(self):
        with mock.patch.object(orchestrator, "output", side_effect=["", "", ""]):
            self.assertEqual(orchestrator.changed_line_count(WORKTREE, BASE), 0)


if __name__ == "__main__":
    unittest.main()
