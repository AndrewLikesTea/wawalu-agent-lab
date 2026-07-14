import datetime as dt
import json
import pathlib
import subprocess
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

    def test_workday_rhythm_uses_persona_windows_and_assignment_delay(self):
        config = {**self.config(), "workday_rhythm": True}
        now = dt.datetime(2026, 7, 14, 16, 0, tzinfo=dt.UTC)  # 09:00 Pacific
        frontend = {"number": 3, "created_at": "2026-07-14T12:00:00Z",
                    "labels": [{"name": "persona:frontend"}]}
        backend = {"number": 4, "created_at": "2026-07-14T12:00:00Z",
                   "labels": [{"name": "persona:backend"}]}
        self.assertFalse(autonomous.within_persona_window("frontend", config, now))
        self.assertTrue(autonomous.within_persona_window("backend", config, now))
        self.assertEqual(autonomous.choose_issue([frontend, backend], autonomous.State(pathlib.Path(tempfile.gettempdir()) / "rhythm-state.json"), config, now)["number"], 4)
        self.assertGreaterEqual(autonomous.issue_delay_seconds(backend), 20 * 60)
        self.assertLessEqual(autonomous.issue_delay_seconds(backend), 90 * 60)

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

    FOLLOWUP_PLAN = [
        {"persona": "backend", "title": "Model notifications", "outcome": "Notification model exists",
         "acceptance_criteria": ["Model is bounded", "Tests pass"]},
        {"persona": "frontend", "title": "Show notifications", "outcome": "Depends on the model",
         "acceptance_criteria": ["Feed is accessible", "Tests pass"]},
    ]

    def consultation_workspace(self, tmp, directive):
        pathlib.Path(tmp, "PRODUCT.md").write_text("Product")
        pathlib.Path(tmp, "personas").mkdir(exist_ok=True)
        pathlib.Path(tmp, "personas", "manager.md").write_text("Sam")
        store = autonomous.DirectiveStore()
        store.path.write_text(json.dumps(directive))
        return store

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 24}, {"number": 25}])
    @mock.patch.object(autonomous, "propose_directive_plan")
    @mock.patch.object(autonomous, "consult_next_steps", return_value="Add notifications")
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_completed_mvp_consults_and_queues_followup_program(
            self, github, recent, personas, runtime, consult, propose, create):
        propose.return_value = self.FOLLOWUP_PLAN
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), "claude")
            self.assertEqual([item["number"] for item in issues], [24, 25])
            value = autonomous.DirectiveStore().read_any()
            rounds = value["consultations"]
            self.assertEqual(rounds[0]["worker"], "claude")
            self.assertEqual(rounds[0]["idea"], "Add notifications")
            self.assertEqual(rounds[0]["created_issues"],
                             [{"index": 0, "issue": 24}, {"index": 1, "issue": 25}])
        consult.assert_called_once()
        self.assertEqual(propose.call_args.kwargs["advisory"], "Add notifications")
        self.assertEqual(propose.call_args.args[3], "Build social")
        self.assertEqual(create.call_args_list[1].args[3], 24)

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 30}, {"number": 31}])
    @mock.patch.object(autonomous, "propose_directive_plan")
    @mock.patch.object(autonomous, "consult_next_steps", return_value="Harden operations")
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_consultation_repeats_after_each_completed_round(
            self, github, recent, personas, runtime, consult, propose, create):
        propose.return_value = self.FOLLOWUP_PLAN
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "plan": [{"title": "done"}],
                                   "created_issues": [{"index": 0, "issue": 24}]}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), "claude")
            self.assertEqual([item["number"] for item in issues], [30, 31])
            self.assertEqual(len(autonomous.DirectiveStore().read_any()["consultations"]), 2)
        consult.assert_called_once()

    @mock.patch.object(autonomous, "github")
    def test_consultation_waits_for_open_followup_round(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = autonomous.DirectiveStore()
            store.path.write_text(json.dumps({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "plan": [{"title": "pending"}],
                                   "created_issues": [{"index": 0, "issue": 24}]}],
            }))
            github.return_value = {"state": "open"}
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
        self.assertIsNone(result)
        consult.assert_not_called()
        self.assertEqual(github.call_args.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/issues/24")

    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_consultation_round_cap_stops_new_rounds(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = autonomous.DirectiveStore()
            store.path.write_text(json.dumps({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "plan": [{"title": "done"}],
                                   "created_issues": [{"index": 0, "issue": 24}]}],
            }))
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready", "max_consultation_rounds": 1}, mock.Mock())
        self.assertIsNone(result)
        consult.assert_not_called()

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 30}, {"number": 31}])
    @mock.patch.object(autonomous, "propose_directive_plan")
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_interrupted_round_resumes_without_repeating_the_paid_consult(
            self, github, recent, propose, create):
        propose.return_value = self.FOLLOWUP_PLAN
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "claude", "idea": "Add notifications",
                                   "created_issues": []}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
            self.assertEqual([item["number"] for item in issues], [30, 31])
        consult.assert_not_called()
        self.assertEqual(propose.call_args.kwargs["advisory"], "Add notifications")

    @mock.patch.object(autonomous, "github")
    def test_legacy_single_consultation_migrates_to_a_completed_round(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = autonomous.DirectiveStore()
            store.path.write_text(json.dumps({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultation": {"worker": "claude", "issue": 24},
            }))
            github.return_value = {"state": "open"}
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
            migrated = autonomous.DirectiveStore().read_any()
        self.assertIsNone(result)
        consult.assert_not_called()
        self.assertNotIn("consultation", migrated)
        self.assertEqual(migrated["consultations"][0]["created_issues"], [{"index": 0, "issue": 24}])

    OWNER_PULL = {"number": 40, "title": "Consultation rounds", "body": "Runner change",
                  "draft": False, "user": {"login": "AndrewLikesTea"},
                  "head": {"sha": "abc123", "ref": "owner/consultation-rounds"}}

    def review_workspace(self, tmp):
        pathlib.Path(tmp, "personas").mkdir(exist_ok=True)
        pathlib.Path(tmp, "personas", "reviewer.md").write_text("Marcus")
        return autonomous.State(pathlib.Path(tmp) / "state.json")

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "reviewer_token", return_value="reviewer-token")
    @mock.patch.object(autonomous, "review_pull_request",
                       return_value={"approved": True, "feedback": "", "summary": "Sound change"})
    @mock.patch.object(autonomous, "fetch_pull_diff", return_value="diff")
    @mock.patch.object(autonomous, "github")
    def test_owner_pr_is_reviewed_approved_and_auto_merged(
            self, github, diff, review, token, merge):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = self.review_workspace(tmp)
            github.side_effect = [[dict(self.OWNER_PULL)], [], None]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            self.assertEqual(approved, [40])
            self.assertEqual(state.value["pr_reviews"]["40"]["sha"], "abc123")
            self.assertTrue(state.value["pr_reviews"]["40"]["approved"])
        submitted = github.call_args_list[2]
        self.assertEqual(submitted.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/pulls/40/reviews")
        self.assertEqual(submitted.args[1], "reviewer-token")
        self.assertEqual(submitted.args[3]["commit_id"], "abc123")
        self.assertEqual(submitted.args[3]["event"], "APPROVE")
        merge.assert_called_once()
        self.assertEqual(merge.call_args.args[1], "owner/consultation-rounds")

    @mock.patch.object(autonomous, "review_pull_request")
    @mock.patch.object(autonomous, "github")
    def test_pr_with_current_synthetic_approval_is_skipped(self, github, review):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [[dict(self.OWNER_PULL)], [
                {"state": "APPROVED", "commit_id": "abc123",
                 "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
        self.assertEqual(approved, [])
        review.assert_not_called()

    @mock.patch.object(autonomous, "review_pull_request")
    @mock.patch.object(autonomous, "github")
    def test_foreign_pr_without_team_approval_is_ignored(self, github, review):
        pull = dict(self.OWNER_PULL, user={"login": "someone-else"})
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [[pull], []]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
        self.assertEqual(approved, [])
        review.assert_not_called()

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "reviewer_token", return_value="reviewer-token")
    @mock.patch.object(autonomous, "review_pull_request",
                       return_value={"approved": True, "feedback": "", "summary": "Still sound"})
    @mock.patch.object(autonomous, "fetch_pull_diff", return_value="diff")
    @mock.patch.object(autonomous, "github")
    def test_stale_team_approval_is_rereviewed_without_auto_merge(
            self, github, diff, review, token, merge):
        pull = dict(self.OWNER_PULL, user={"login": "wawalu-agent-implementer[bot]"})
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = self.review_workspace(tmp)
            github.side_effect = [[pull], [
                {"state": "APPROVED", "commit_id": "old-sha",
                 "user": {"login": "wawalu-synthetic-reviewer[bot]"}}], None]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
        self.assertEqual(approved, [40])
        merge.assert_not_called()

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "reviewer_token", return_value="reviewer-token")
    @mock.patch.object(autonomous, "review_pull_request",
                       return_value={"approved": False, "feedback": "Missing tests", "summary": "No"})
    @mock.patch.object(autonomous, "fetch_pull_diff", return_value="diff")
    @mock.patch.object(autonomous, "github")
    def test_rejected_owner_pr_gets_feedback_not_approval(
            self, github, diff, review, token, merge):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = self.review_workspace(tmp)
            github.side_effect = [[dict(self.OWNER_PULL)], [], None]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            self.assertFalse(state.value["pr_reviews"]["40"]["approved"])
        self.assertEqual(approved, [])
        commented = github.call_args_list[2]
        self.assertEqual(commented.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/issues/40/comments")
        self.assertIn("Missing tests", commented.args[3]["body"])
        merge.assert_not_called()

    @mock.patch.object(autonomous, "review_pull_request")
    @mock.patch.object(autonomous, "github")
    def test_processed_head_is_not_rereviewed(self, github, review):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["pr_reviews"]["40"] = {"sha": "abc123", "approved": False}
            github.side_effect = [[dict(self.OWNER_PULL)], []]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
        self.assertEqual(approved, [])
        review.assert_not_called()
        self.assertEqual(github.call_count, 2)

    @mock.patch.object(autonomous, "review_pull_request")
    @mock.patch.object(autonomous, "github")
    def test_approved_behind_pr_gets_branch_update(self, github, review):
        pull = dict(self.OWNER_PULL, auto_merge={"merge_method": "squash"})
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [
                [pull],
                [{"state": "APPROVED", "commit_id": "abc123",
                  "user": {"login": "wawalu-synthetic-reviewer[bot]"}}],
                {"mergeable_state": "behind"},
                None,
            ]
            approved = autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            self.assertEqual(state.value["pr_updates"]["40"]["result"], "updated")
        self.assertEqual(approved, [])
        review.assert_not_called()
        updated = github.call_args_list[3]
        self.assertEqual(updated.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/pulls/40/update-branch")
        self.assertEqual(updated.args[2], "PUT")
        self.assertEqual(updated.args[3], {"expected_head_sha": "abc123"})

    @mock.patch.object(autonomous, "github")
    def test_conflicted_pr_gets_one_comment_per_head(self, github):
        pull = dict(self.OWNER_PULL, auto_merge={"merge_method": "squash"})
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [{"mergeable_state": "dirty"}, None]
            autonomous.update_pull_branch(pull, "token", {}, state, mock.Mock())
            self.assertEqual(state.value["pr_updates"]["40"]["result"], "conflict")
            commented = github.call_args_list[1]
            self.assertEqual(commented.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/issues/40/comments")
            self.assertIn("conflicts with `main`", commented.args[3]["body"])
            autonomous.update_pull_branch(pull, "token", {}, state, mock.Mock())
        self.assertEqual(github.call_count, 2)

    @mock.patch.object(autonomous, "github")
    def test_update_branch_skips_when_not_behind(self, github):
        pull = dict(self.OWNER_PULL, auto_merge={"merge_method": "squash"})
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [{"mergeable_state": "blocked"}]
            autonomous.update_pull_branch(pull, "token", {}, state, mock.Mock())
            self.assertNotIn("40", state.value["pr_updates"])
        github.assert_called_once()

    AGENT_PULL = {"number": 41, "title": "Decision detail", "body": "Closes #8",
                  "draft": False, "user": {"login": "wawalu-agent-implementer[bot]"},
                  "auto_merge": {"merge_method": "squash"},
                  "head": {"sha": "def456", "ref": "agent/staff/issue-8-decision-detail"}}

    @mock.patch.object(autonomous, "github")
    def test_conflicted_agent_pr_is_closed_and_issue_requeued(self, github):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["8"] = {"status": "submitted", "persona": "staff", "attempts": 1}
            github.side_effect = [
                {"mergeable_state": "dirty"},
                {"state": "open", "number": 8,
                 "labels": [{"name": "agent-running"}, {"name": "persona:staff"}]},
                None, None, None, None,
            ]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready"}, state, mock.Mock())
            record = state.value["issues"]["8"]
            self.assertEqual(record["status"], "requeued")
            self.assertEqual(record["attempts"], 1)
        closed = github.call_args_list[2]
        self.assertEqual(closed.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/pulls/41")
        self.assertEqual(closed.args[3], {"state": "closed"})
        deleted = github.call_args_list[3]
        self.assertEqual(deleted.args[0],
                         "/repos/AndrewLikesTea/wawalu-agent-lab/git/refs/heads/agent/staff/issue-8-decision-detail")
        self.assertEqual(deleted.args[2], "DELETE")
        relabeled = github.call_args_list[4]
        self.assertEqual(sorted(relabeled.args[3]["labels"]), ["agent-ready", "persona:staff"])
        commented = github.call_args_list[5]
        self.assertEqual(commented.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/issues/8/comments")
        self.assertIn("fresh implementation", commented.args[3]["body"])

    @mock.patch.object(autonomous, "github")
    def test_conflicted_agent_pr_with_closed_issue_only_gets_comment(self, github):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [{"mergeable_state": "dirty"}, {"state": "closed"}, None]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready"}, state, mock.Mock())
        commented = github.call_args_list[2]
        self.assertEqual(commented.args[0], "/repos/AndrewLikesTea/wawalu-agent-lab/issues/41/comments")
        self.assertIn("manual rebase", commented.args[3]["body"])

    @mock.patch.object(autonomous, "github")
    def test_conflict_with_exhausted_attempts_blocks_instead_of_requeueing(self, github):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["8"] = {"status": "submitted", "persona": "staff", "attempts": 2}
            github.side_effect = [
                {"mergeable_state": "dirty"},
                {"state": "open", "number": 8,
                 "labels": [{"name": "agent-running"}, {"name": "persona:staff"}]},
                None, None, None, None,
            ]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready", "max_attempts": 2},
                                          state, mock.Mock())
            self.assertEqual(state.value["issues"]["8"]["status"], "blocked")
        relabeled = github.call_args_list[4]
        self.assertIn("agent-blocked", relabeled.args[3]["labels"])
        self.assertNotIn("agent-ready", relabeled.args[3]["labels"])
        self.assertIn("human attention", github.call_args_list[5].args[3]["body"])

    @mock.patch.object(autonomous, "github")
    def test_concurrent_sweep_is_skipped_via_lock(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            journal = mock.Mock()
            with autonomous.try_lock(autonomous.AUTONOMY / "sweep.lock") as owned:
                self.assertTrue(owned)
                approved = autonomous.review_outstanding_prs("token", {}, state, journal)
        self.assertEqual(approved, [])
        github.assert_not_called()
        self.assertEqual(journal.emit.call_args.args[0], "pr_sweep_skipped")

    @mock.patch.object(autonomous, "github")
    def test_sweep_prunes_state_for_closed_prs(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["pr_reviews"]["99"] = {"sha": "gone", "approved": True}
            state.value["pr_updates"]["98"] = {"sha": "gone", "result": "updated"}
            github.side_effect = [[]]
            autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            self.assertEqual(state.value["pr_reviews"], {})
            self.assertEqual(state.value["pr_updates"], {})
            persisted = json.loads(state.path.read_text())
            self.assertEqual(persisted["pr_reviews"], {})

    @mock.patch.object(autonomous, "consult_next_steps", side_effect=RuntimeError("cli down"))
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    def test_failed_consultations_switch_worker_after_two_attempts(
            self, personas, runtime, consult):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "created_issues": []}],
            })
            for expected_worker, expected_attempts in (("codex", 1), ("claude", 0)):
                with self.assertRaisesRegex(RuntimeError, "cli down"):
                    autonomous.consult_after_directive_mvp(
                        "token", {"issue_label": "agent-ready"}, mock.Mock())
                value = autonomous.DirectiveStore().read_any()["consultations"][0]
                self.assertEqual(value.get("consult_attempts", 0), expected_attempts)
            self.assertEqual(value["worker"], "claude")

    @mock.patch.object(autonomous, "sweep_outstanding_prs")
    @mock.patch.object(autonomous, "installation_token", return_value="token")
    def test_after_hours_sweep_runs_only_when_enabled(self, token, sweep):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "STOP", pathlib.Path(tmp) / "STOP"):
            config = {"enabled": True, "working_hours": {"start": 0, "end": 0},
                      "review_prs_after_hours": True}
            result = autonomous.tick(config, mock.Mock(), mock.Mock())
        self.assertEqual(result, "outside-working-hours")
        sweep.assert_called_once()

    @mock.patch.object(autonomous, "github")
    def test_conflicted_pr_requeue_can_be_disabled(self, github):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [{"mergeable_state": "dirty"}, None]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"requeue_conflicted_prs": False}, state, mock.Mock())
        self.assertEqual(github.call_count, 2)
        self.assertIn("/issues/41/comments", github.call_args_list[1].args[0])

    @mock.patch.object(autonomous, "update_pull_branch")
    @mock.patch.object(autonomous, "github")
    def test_approved_pr_without_auto_merge_is_not_updated(self, github, update):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [[dict(self.OWNER_PULL)], [
                {"state": "APPROVED", "commit_id": "abc123",
                 "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]]
            autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
        update.assert_not_called()

    def test_directive_summary_shows_consultation_evolution(self):
        self.assertIsNone(autonomous.summarize_directive(None))
        summary = autonomous.summarize_directive({
            "status": "consumed", "text": "Build social", "created_at": "2026-07-14T16:19:00+00:00",
            "created_issues": [{"index": 0, "issue": 20}, {"index": 1, "issue": 21}],
            "consultations": [
                {"worker": "codex", "created_at": "2026-07-15T01:00:00+00:00",
                 "idea": "Add notifications", "created_issues": [{"index": 0, "issue": 30}]},
                {"worker": "claude", "created_at": "2026-07-16T01:00:00+00:00",
                 "created_issues": []},
            ],
            "plan": [{"title": "internal detail that should not leak"}],
        })
        self.assertEqual(summary["issues"], [20, 21])
        self.assertEqual(summary["consultations"][0],
                         {"round": 1, "worker": "codex", "created_at": "2026-07-15T01:00:00+00:00",
                          "idea": "Add notifications", "issues": [30]})
        self.assertEqual(summary["consultations"][1]["round"], 2)
        self.assertIsNone(summary["consultations"][1]["idea"])
        self.assertNotIn("plan", summary)

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

    @mock.patch.object(autonomous.os, "killpg")
    @mock.patch.object(autonomous.subprocess, "Popen")
    def test_worker_timeout_terminates_the_entire_process_group(self, popen, killpg):
        process = popen.return_value
        process.pid = 123
        process.wait.side_effect = [subprocess.TimeoutExpired("worker", 30), 0]
        journal = mock.Mock()
        self.assertEqual(autonomous.run_worker_process(["worker"], 30, journal, 9), 124)
        popen.assert_called_once_with(["worker"], cwd=autonomous.ROOT, start_new_session=True)
        killpg.assert_called_once_with(123, autonomous.signal.SIGTERM)
        journal.emit.assert_called_once_with("run_timeout", issue=9, timeout_seconds=30)

    def test_launch_agent_path_includes_user_cli_directory(self):
        value = launch_path(pathlib.Path("/Users/demo"))
        self.assertEqual(value.split(":"), [
            "/Users/demo/.local/bin", "/opt/homebrew/bin", "/usr/local/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ])


if __name__ == "__main__":
    unittest.main()
