import datetime as dt
import pathlib
import tempfile
import unittest

from runner.budget import DiffBudget


class DiffBudgetTests(unittest.TestCase):
    def test_records_up_to_limit_and_rejects_next_diff(self):
        now = dt.datetime(2026, 7, 14, tzinfo=dt.UTC)
        with tempfile.TemporaryDirectory() as tmp:
            budget = DiffBudget(pathlib.Path(tmp), limit=2)
            self.assertEqual(budget.record({"run_id": "one"}, now), 1)
            self.assertEqual(budget.record({"run_id": "two"}, now), 0)
            with self.assertRaisesRegex(RuntimeError, "daily approved diff limit"):
                budget.record({"run_id": "three"}, now)

    def test_uses_a_new_ledger_each_utc_day(self):
        with tempfile.TemporaryDirectory() as tmp:
            budget = DiffBudget(pathlib.Path(tmp), limit=1)
            budget.record({"run_id": "one"}, dt.datetime(2026, 7, 14, 23, tzinfo=dt.UTC))
            budget.ensure_available(dt.datetime(2026, 7, 15, 0, tzinfo=dt.UTC))


if __name__ == "__main__":
    unittest.main()
