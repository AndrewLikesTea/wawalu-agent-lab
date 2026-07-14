import unittest
from unittest import mock

from scripts.check_reviewer_approval import approved_current_head, wait_for_approval


class ReviewerGateTests(unittest.TestCase):
    def test_accepts_reviewer_app_approval_for_exact_head(self):
        reviews = [{"state": "APPROVED", "commit_id": "abc",
                    "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]
        self.assertTrue(approved_current_head(reviews, "abc"))

    def test_rejects_stale_or_human_approval(self):
        stale = [{"state": "APPROVED", "commit_id": "old",
                  "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]
        human = [{"state": "APPROVED", "commit_id": "abc",
                  "user": {"login": "AndrewLikesTea"}}]
        self.assertFalse(approved_current_head(stale, "abc"))
        self.assertFalse(approved_current_head(human, "abc"))

    def test_gate_polls_until_the_sweep_approves(self):
        approved = [{"state": "APPROVED", "commit_id": "abc",
                     "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]
        naps = []
        with mock.patch("scripts.check_reviewer_approval.fetch_reviews",
                        side_effect=[[], [], approved]):
            self.assertTrue(wait_for_approval("r", "1", "abc", "t", wait_seconds=900,
                                              poll_seconds=30, sleeper=naps.append))
        self.assertEqual(naps, [30, 30])

    def test_gate_gives_up_after_the_wait_budget(self):
        naps = []
        with mock.patch("scripts.check_reviewer_approval.fetch_reviews", return_value=[]):
            self.assertFalse(wait_for_approval("r", "1", "abc", "t", wait_seconds=60,
                                               poll_seconds=45, sleeper=naps.append))
        self.assertEqual(naps, [45, 15])

    def test_gate_default_is_a_single_check(self):
        with mock.patch("scripts.check_reviewer_approval.fetch_reviews",
                        return_value=[]) as fetch:
            self.assertFalse(wait_for_approval("r", "1", "abc", "t"))
        fetch.assert_called_once()

    def test_handles_malformed_and_multiple_reviews(self):
        reviews = [None, {}, {"state": "COMMENTED", "commit_id": "abc", "user": {}},
                   {"state": "APPROVED", "commit_id": "abc",
                    "user": {"login": "wawalu-synthetic-reviewer"}}]
        self.assertTrue(approved_current_head(reviews, "abc"))


if __name__ == "__main__":
    unittest.main()
