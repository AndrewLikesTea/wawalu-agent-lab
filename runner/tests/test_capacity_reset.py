import datetime as dt
import pathlib
import tempfile
import unittest

from runner.autonomous import State
from runner.layers import parse_capacity_reset


class ParseCapacityResetTest(unittest.TestCase):
    def test_reads_stated_reset_and_rolls_past_times_to_tomorrow(self):
        now = dt.datetime(2026, 7, 27, 16, 0, tzinfo=dt.UTC)
        later = parse_capacity_reset("5-hour limit reached; resets 8:50pm", now)
        self.assertIsNotNone(later)
        self.assertGreater(later, now)
        self.assertLess(later, now + dt.timedelta(days=1))

    def test_ignores_refusals_that_state_no_time(self):
        self.assertIsNone(parse_capacity_reset("usage limit reached", dt.datetime.now(dt.UTC)))


class CooldownClampTest(unittest.TestCase):
    def test_stated_reset_shortens_but_never_lengthens_the_cooldown(self):
        now = dt.datetime(2026, 7, 27, 16, 0, tzinfo=dt.UTC)
        with tempfile.TemporaryDirectory() as tmp:
            state = State(pathlib.Path(tmp) / "state.json")
            short = state.record_worker_capacity(
                "codex", 900, now=now, maximum_seconds=3600, reset_at=now + dt.timedelta(seconds=120))
            self.assertEqual(short, 120)
        with tempfile.TemporaryDirectory() as tmp:
            state = State(pathlib.Path(tmp) / "state.json")
            unclamped = state.record_worker_capacity(
                "codex", 900, now=now, maximum_seconds=3600, reset_at=now + dt.timedelta(days=5))
            self.assertEqual(unclamped, 900)


if __name__ == "__main__":
    unittest.main()
