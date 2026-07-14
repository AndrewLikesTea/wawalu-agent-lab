import unittest

from scripts.check_reviewer_approval import approved_current_head


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

    def test_handles_malformed_and_multiple_reviews(self):
        reviews = [None, {}, {"state": "COMMENTED", "commit_id": "abc", "user": {}},
                   {"state": "APPROVED", "commit_id": "abc",
                    "user": {"login": "wawalu-synthetic-reviewer"}}]
        self.assertTrue(approved_current_head(reviews, "abc"))


if __name__ == "__main__":
    unittest.main()
