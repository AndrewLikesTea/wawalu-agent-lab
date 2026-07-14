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
                "working_hours": {"start": 8, "end": 18}, "min_pr_interval_seconds": 3600}

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

    def test_persona_pr_limit_uses_rolling_hour_and_ignores_other_engineers(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = dt.datetime(2026, 7, 14, 16, 0, tzinfo=dt.UTC)
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_submission("frontend", now)
            self.assertFalse(state.persona_available("frontend", 3600, now + dt.timedelta(minutes=59)))
            self.assertTrue(state.persona_available("frontend", 3600, now + dt.timedelta(hours=1)))
            self.assertTrue(state.persona_available("backend", 3600, now + dt.timedelta(minutes=1)))

    def test_choose_issue_skips_persona_inside_pr_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp:
            now = dt.datetime(2026, 7, 14, 16, 0, tzinfo=dt.UTC)
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_submission("frontend", now)
            issues = [
                {"number": 1, "labels": [{"name": "persona:frontend"}]},
                {"number": 2, "labels": [{"name": "persona:backend"}]},
            ]
            self.assertEqual(autonomous.choose_issue(issues, state, self.config(), now)["number"], 2)

    def test_working_hours_are_pacific_even_for_utc_input(self):
        config = self.config()
        self.assertTrue(autonomous.within_hours(config, dt.datetime(2026, 7, 14, 15, 0, tzinfo=dt.UTC)))
        self.assertFalse(autonomous.within_hours(config, dt.datetime(2026, 7, 15, 1, 0, tzinfo=dt.UTC)))

    def test_directive_is_private_persistent_and_consumed(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = autonomous.DirectiveStore(pathlib.Path(tmp) / "directive.json")
            value = store.set("  Prioritize   release history  ")
            self.assertEqual(value["text"], "Prioritize release history")
            self.assertEqual(store.path.stat().st_mode & 0o777, 0o600)
            store.consume(14)
            self.assertIsNone(store.read())
            persisted = json.loads(store.path.read_text())
            self.assertEqual(persisted["issue"], 14)

    def test_directive_rejects_empty_and_oversized_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = autonomous.DirectiveStore(pathlib.Path(tmp) / "directive.json")
            with self.assertRaisesRegex(ValueError, "empty"):
                store.set("  ")
            with self.assertRaisesRegex(ValueError, "4,000"):
                store.set("x" * 4001)

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

    def test_program_task_waits_for_open_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            now = dt.datetime(2026, 7, 14, tzinfo=dt.UTC)
            issues = [
                {"number": 20, "body": "foundation", "labels": [{"name": "persona:backend"}]},
                {"number": 21, "body": "Depends on #20.", "labels": [{"name": "persona:frontend"}]},
            ]
            self.assertEqual(autonomous.choose_issue(issues, state, self.config(), now)["number"], 20)
            state.value["issues"]["20"] = {"status": "submitted"}
            self.assertIsNone(autonomous.choose_issue(issues, state, self.config(), now))
            self.assertEqual(autonomous.choose_issue([issues[1]], state, self.config(), now)["number"], 21)

    def test_scenario_and_persona_label_are_bounded(self):
        issue = {"number": 9, "title": "Add release filters", "body": "Outcome body",
                 "labels": [{"name": "persona:frontend"}]}
        self.assertEqual(autonomous.issue_label(issue, "persona:"), "frontend")
        scenario = autonomous.scenario_from_issue(issue, "frontend")
        self.assertEqual(scenario["issue"], 9)
        self.assertEqual(scenario["assigned_persona"], "frontend")

    @mock.patch.object(autonomous, "github")
    def test_recent_issue_context_includes_engineer_assignment(self, github):
        github.return_value = [
            {"title": "Build API", "labels": [{"name": "persona:backend"}]},
            {"title": "A pull request", "pull_request": {}, "labels": []},
            {"title": "Untriaged", "labels": []},
        ]
        self.assertEqual(autonomous.recent_issue_context("token"), [
            "[Rowan (backend)] Build API", "[unassigned] Untriaged",
        ])

    @mock.patch.object(autonomous, "github")
    def test_consultation_waits_until_every_mvp_issue_is_closed(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = autonomous.DirectiveStore()
            store.path.write_text(json.dumps({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}, {"index": 1, "issue": 21}],
            }))
            github.side_effect = [{"state": "closed"}, {"state": "open"}]
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
        self.assertIsNone(result)
        consult.assert_not_called()

    @mock.patch.object(autonomous, "create_generated_issue", return_value={"number": 24})
    @mock.patch.object(autonomous, "propose_task", return_value={
        "persona": "infrastructure", "title": "Scale the feed", "outcome": "Reliable growth",
        "acceptance_criteria": ["Load is bounded", "Tests pass"],
    })
    @mock.patch.object(autonomous, "consult_next_steps", return_value="Add caching")
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_completed_mvp_consults_once_and_queues_followup(
            self, github, recent, personas, runtime, consult, propose, create):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            pathlib.Path(tmp, "PRODUCT.md").write_text("Product")
            pathlib.Path(tmp, "personas").mkdir()
            pathlib.Path(tmp, "personas", "manager.md").write_text("Sam")
            store = autonomous.DirectiveStore()
            store.path.write_text(json.dumps({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            }))
            issue = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), "claude")
            self.assertEqual(issue["number"], 24)
            self.assertEqual(autonomous.DirectiveStore().read_any()["consultation"]["worker"], "claude")
        consult.assert_called_once()
        self.assertNotIn("Add caching", propose.call_args.args[4])
        self.assertEqual(propose.call_args.kwargs["advisory"], "Add caching")

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

    @mock.patch.object(autonomous.subprocess, "run")
    def test_cleanup_targets_only_the_run_worktree_and_branch(self, run):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "staff-task"
            path.mkdir()
            run.side_effect = [mock.Mock(returncode=0), mock.Mock(returncode=0), mock.Mock(returncode=0)]
            autonomous.cleanup_worktree(path, "agent/staff/task", mock.Mock())
        self.assertEqual(run.call_args_list[1].args[0],
                         ["git", "worktree", "remove", "--force", str(path)])
        self.assertEqual(run.call_args_list[2].args[0],
                         ["git", "branch", "--delete", "--force", "agent/staff/task"])

    def test_launch_agent_path_includes_user_cli_directory(self):
        value = launch_path(pathlib.Path("/Users/demo"))
        self.assertEqual(value.split(":"), [
            "/Users/demo/.local/bin", "/opt/homebrew/bin", "/usr/local/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ])


if __name__ == "__main__":
    unittest.main()
