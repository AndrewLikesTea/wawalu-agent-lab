import datetime as dt
import json
import pathlib
import tempfile
import unittest
from unittest import mock

from runner import autonomous
from scripts.manage_autonomy import launch_path


class AutonomousTests(unittest.TestCase):
    def config(self):
        return {"retry_cooldown_seconds": 60, "max_attempts": 2,
                "working_hours": {"start": 8, "end": 22}}

    def test_singleton_rejects_second_manager(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "lock"
            with autonomous.singleton(path):
                with self.assertRaisesRegex(RuntimeError, "already running"):
                    with autonomous.singleton(path):
                        pass

    def test_state_enforces_daily_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = dt.datetime(2026, 7, 14, tzinfo=dt.UTC)
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_run(now); state.record_run(now)
            self.assertEqual(state.runs_today(now), 2)
            self.assertEqual(json.loads(state.path.read_text())["daily_runs"]["2026-07-14"], 2)

    def test_choose_issue_skips_submitted_blocked_and_cooling_down(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            now = dt.datetime(2026, 7, 14, tzinfo=dt.UTC)
            state.value["issues"] = {
                "1": {"status": "submitted"},
                "2": {"status": "retry", "attempts": 1,
                      "retry_at": (now + dt.timedelta(minutes=5)).isoformat()},
            }
            selected = autonomous.choose_issue([{"number": 1}, {"number": 2}, {"number": 3}],
                                               state, self.config(), now)
            self.assertEqual(selected["number"], 3)

    def test_scenario_and_persona_label_are_bounded(self):
        issue = {"number": 9, "title": "Add release filters", "body": "Outcome body",
                 "labels": [{"name": "persona:frontend"}]}
        self.assertEqual(autonomous.issue_label(issue, "persona:"), "frontend")
        scenario = autonomous.scenario_from_issue(issue, "frontend")
        self.assertEqual(scenario["issue"], 9)
        self.assertEqual(scenario["assigned_persona"], "frontend")

    @mock.patch.object(autonomous, "sync_main")
    def test_tick_honors_stop_before_network_or_sync(self, sync):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "STOP", pathlib.Path(tmp) / "STOP"):
            autonomous.STOP.touch()
            result = autonomous.tick({"enabled": True}, mock.Mock(), mock.Mock(), "token")
        self.assertEqual(result, "stopped")
        sync.assert_not_called()

    @mock.patch.object(autonomous, "installation_token")
    def test_tick_does_not_mint_token_outside_working_hours(self, token):
        config = {"enabled": True, "working_hours": {"start": 0, "end": 0},
                  "max_runs_per_day": 1}
        result = autonomous.tick(config, mock.Mock(), mock.Mock())
        self.assertEqual(result, "outside-working-hours")
        token.assert_not_called()

    @mock.patch.object(autonomous, "github")
    def test_state_label_cannot_leave_ready_queue_after_submission(self, github):
        issue = {"number": 4, "labels": [{"name": "agent-ready"}, {"name": "persona:backend"}]}
        autonomous.replace_state_label("token", issue, "agent-ready", "agent-running", keep_ready=False)
        self.assertEqual(github.call_args.args[1], "token")
        self.assertEqual(github.call_args.args[2], "PATCH")
        self.assertEqual(github.call_args.args[3]["labels"], ["persona:backend", "agent-running"])

    def test_launch_agent_path_includes_user_cli_directory(self):
        value = launch_path(pathlib.Path("/Users/demo"))
        self.assertEqual(value.split(":"), [
            "/Users/demo/.local/bin", "/opt/homebrew/bin", "/usr/local/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ])


if __name__ == "__main__":
    unittest.main()
