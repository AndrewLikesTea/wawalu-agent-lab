import contextlib
import datetime as dt
import json
import pathlib
import subprocess
import tempfile
import threading
import unittest
import urllib.error
from unittest import mock

from runner import autonomous, github_app, orchestrator
from scripts.manage_autonomy import launch_path


REPO = autonomous.REPOSITORY


def seed_directives(*values):
    """Seed the directive book the way an earlier tick would have left it."""
    directives = []
    for index, value in enumerate(values):
        value.setdefault("id", f"seeded-{index}")
        directives.append(value)
    autonomous.DirectiveBook().write(directives)
    return autonomous.DirectiveStore(directives[0]["id"])


class IsolatedDiffBudget(unittest.TestCase):
    """Keep tick's diff-budget rail off the developer's real ledger.

    tick refuses to start runs once the day's approved diffs are spent. Without
    this the suite passes or fails depending on how much work the live fleet
    happened to ship today.
    """

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        budget = autonomous.BUDGET
        self.addCleanup(setattr, budget, "directory", budget.directory)
        budget.directory = pathlib.Path(directory.name)


class AutonomousTests(IsolatedDiffBudget):
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
        self.assertGreaterEqual(autonomous.issue_delay_seconds(backend), 1 * 60)
        self.assertLessEqual(autonomous.issue_delay_seconds(backend), 6 * 60)

    def directive_book(self, tmp):
        return autonomous.DirectiveBook(pathlib.Path(tmp) / "directives.json",
                                        legacy=pathlib.Path(tmp) / "directive.json")

    def test_directive_is_private_persistent_and_consumed(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = self.directive_book(tmp)
            value = book.add("  Prioritize   release history  ")
            self.assertEqual(value["text"], "Prioritize release history")
            self.assertEqual(book.path.stat().st_mode & 0o777, 0o600)
            store = autonomous.DirectiveStore(value["id"], book)
            store.consume(14)
            self.assertIsNone(store.read())
            self.assertEqual(book.get(value["id"])["issue"], 14)
            self.assertEqual(book.get(value["id"])["status"], "consumed")

    def test_directive_rejects_empty_and_oversized_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = self.directive_book(tmp)
            with self.assertRaisesRegex(ValueError, "empty"):
                book.add("  ")
            with self.assertRaisesRegex(ValueError, "4,000"):
                book.add("x" * 4001)
            with self.assertRaisesRegex(ValueError, "unknown persona"):
                book.add("Scope this", ["nobody"])

    def test_several_directives_live_side_by_side(self):
        """Setting a second directive must not overwrite a live program's record."""
        with tempfile.TemporaryDirectory() as tmp:
            book = self.directive_book(tmp)
            social = book.add("Evolve the social app into a photo feed")
            finops = book.add("Build the AI FinOps executive view",
                              ["product", "design", "evaluation"])
            self.assertNotEqual(social["id"], finops["id"])
            self.assertEqual(len(book.pending()), 2)
            self.assertEqual(finops["personas"], ["product", "design", "evaluation"])
            self.assertNotIn("personas", social)   # unscoped means the whole team

            # Consuming one leaves the other pending and untouched.
            autonomous.DirectiveStore(social["id"], book).consume(20)
            self.assertEqual([item["id"] for item in book.pending()], [finops["id"]])
            self.assertEqual([item["id"] for item in book.consumed()], [social["id"]])

            # Each program records its own issues.
            autonomous.DirectiveStore(finops["id"], book).save_plan([{"persona": "product"}])
            autonomous.DirectiveStore(finops["id"], book).record_created_issue(0, 31)
            self.assertEqual(book.get(finops["id"])["created_issues"], [{"index": 0, "issue": 31}])
            self.assertNotIn("created_issues", book.get(social["id"]))

            # Clearing one is not clearing all.
            self.assertEqual(book.clear(social["id"]), 1)
            self.assertEqual([item["id"] for item in book.read()], [finops["id"]])
            self.assertEqual(book.clear(), 1)
            self.assertEqual(book.read(), [])

    def test_directive_ids_are_stable_readable_and_unique(self):
        with tempfile.TemporaryDirectory() as tmp:
            book = self.directive_book(tmp)
            first = book.add("Build the AI FinOps executive view for engineering leaders")
            self.assertRegex(first["id"], r"^build-finops-executive-[0-9a-f]{6}$")
            second = book.add("Build the AI FinOps executive view for engineering leaders")
            self.assertNotEqual(first["id"], second["id"])
            with self.assertRaisesRegex(ValueError, "already exists"):
                book.add("Another directive", directive_id=first["id"])

    def test_a_single_slot_directive_upgrades_into_the_book(self):
        """An in-flight program must survive the upgrade with its lineage intact."""
        with tempfile.TemporaryDirectory() as tmp:
            legacy = pathlib.Path(tmp) / "directive.json"
            legacy.write_text(json.dumps({
                "status": "consumed", "text": "Build social", "created_at": "2026-07-01T00:00:00+00:00",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "created_issues": [{"index": 0, "issue": 22}]}],
            }))
            book = self.directive_book(tmp)
            carried = book.read()
            self.assertEqual(len(carried), 1)
            self.assertEqual(carried[0]["created_issues"], [{"index": 0, "issue": 20}])
            self.assertEqual(len(carried[0]["consultations"]), 1)
            self.assertTrue(carried[0]["id"])
            # The legacy file is left alone as a backup, and adoption is not repeated.
            self.assertTrue(legacy.exists())
            book.add("A second product line")
            self.assertEqual(len(self.directive_book(tmp).read()), 2)

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
    def test_persona_load_line_counts_open_issues_per_engineer(self, github):
        github.return_value = [
            {"labels": [{"name": "persona:staff"}]},
            {"labels": [{"name": "persona:staff"}]},
            {"labels": [{"name": "persona:frontend"}]},
            {"pull_request": {}, "labels": [{"name": "persona:staff"}]},  # PRs excluded
            {"labels": []},  # untriaged excluded
        ]
        line = autonomous.persona_load_line("token")
        self.assertIn("Rowan (backend) 0", line)
        self.assertIn("Mina (frontend) 1", line)
        self.assertIn("Priya (staff) 2", line)

    @mock.patch.object(autonomous, "github", side_effect=RuntimeError("api down"))
    def test_persona_load_line_is_advisory_and_never_raises(self, github):
        self.assertEqual(autonomous.persona_load_line("token"), "")

    @mock.patch.object(autonomous, "github")
    def test_consultation_waits_until_every_mvp_issue_is_closed(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = seed_directives({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}, {"index": 1, "issue": 21}],
            })
            github.side_effect = [{"state": "closed"}, {"state": "open"}]
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
        self.assertIsNone(result)
        consult.assert_not_called()

    def test_program_task_pending_ignores_a_task_the_team_cannot_finish(self):
        self.assertFalse(autonomous.program_task_pending({"state": "closed", "labels": []}))
        self.assertTrue(autonomous.program_task_pending(
            {"state": "open", "labels": [{"name": "agent-ready"}]}))
        self.assertFalse(autonomous.program_task_pending(
            {"state": "open", "labels": [{"name": "persona:backend"}, {"name": "agent-blocked"}]}))

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 24}, {"number": 25}])
    @mock.patch.object(autonomous, "propose_directive_plan")
    @mock.patch.object(autonomous, "consult_next_steps", return_value="Add notifications")
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github")
    def test_a_blocked_task_does_not_freeze_the_next_consultation(
            self, github, recent, personas, runtime, consult, propose, create):
        propose.return_value = self.FOLLOWUP_PLAN
        github.side_effect = [{"state": "closed", "labels": []},
                              {"state": "open", "labels": [{"name": "agent-blocked"}]}]
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}, {"index": 1, "issue": 21}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), "claude")
        self.assertEqual([item["number"] for item in issues], [24, 25])
        consult.assert_called_once()

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
        store = seed_directives(directive)
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
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), "claude")
            self.assertEqual([item["number"] for item in issues], [24, 25])
            value = autonomous.DirectiveBook().read()[0]
            rounds = value["consultations"]
            self.assertEqual(rounds[0]["worker"], "claude")
            self.assertEqual(rounds[0]["idea"], "Add notifications")
            self.assertEqual(rounds[0]["created_issues"],
                             [{"index": 0, "issue": 24}, {"index": 1, "issue": 25}])
        consult.assert_called_once()
        self.assertEqual(propose.call_args.kwargs["advisory"], "Add notifications")
        self.assertEqual(propose.call_args.args[3], "Build social")
        # Rowan's model and Mina's feed are separate tracks: neither waits on the other.
        self.assertEqual([call.args[3] for call in create.call_args_list], [None, None])

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
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
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
            self.assertEqual(len(autonomous.DirectiveBook().read()[0]["consultations"]), 2)
        consult.assert_called_once()

    @mock.patch.object(autonomous, "github")
    def test_consultation_waits_for_open_followup_round(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = seed_directives({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "plan": [{"title": "pending"}],
                                   "created_issues": [{"index": 0, "issue": 24}]}],
            })
            github.return_value = {"state": "open"}
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
        self.assertIsNone(result)
        consult.assert_not_called()
        self.assertEqual(github.call_args.args[0], f"/repos/{REPO}/issues/24")

    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_consultation_round_cap_stops_new_rounds(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = seed_directives({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultations": [{"worker": "codex", "plan": [{"title": "done"}],
                                   "created_issues": [{"index": 0, "issue": 24}]}],
            })
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
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
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

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 30}, {"number": 31}])
    @mock.patch.object(autonomous, "propose_directive_plan")
    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "recent_issue_context", return_value=[])
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_capacity_limited_consultant_hands_the_round_to_the_other_provider(
            self, github, recent, personas, runtime, propose, create):
        propose.return_value = self.FOLLOWUP_PLAN
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            consult.side_effect = [autonomous.ConsultantCapacityExhausted("claude"), "Add notifications"]
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            issues = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, journal, "claude", state)
            self.assertEqual([item["number"] for item in issues], [30, 31])
            round_one = autonomous.DirectiveBook().read()[0]["consultations"][0]
            self.assertEqual(round_one["worker"], "codex")
            self.assertFalse(state.worker_available("claude"))
        self.assertEqual([call.args[0] for call in consult.call_args_list], ["claude", "codex"])
        self.assertIn("consultation_worker_switched",
                      [call.args[0] for call in journal.emit.call_args_list])

    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_consultation_capacity_cooldown_honours_the_stated_reset(self, github, personas, runtime):
        """A consultation refusal states its own reset; the hold must not outlive it.

        Without the clamp the blind exponential backoff locks the provider out of runs
        too, so the lab idles long after the provider came back.
        """
        journal = mock.Mock()

        def refuse(*args, **kwargs):
            run_dir = args[4]
            run_dir.mkdir(parents=True, exist_ok=True)
            # The refusal states a wall-clock time in the machine's local zone.
            soon = (autonomous.utc_now() + dt.timedelta(minutes=4)).astimezone().strftime("%-I:%M%p").lower()
            (run_dir / "codex.jsonl").write_text(
                f"You've hit your session limit · resets {soon}\n", encoding="utf-8")
            raise autonomous.ConsultantCapacityExhausted("codex")

        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "consult_next_steps", side_effect=refuse):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_worker_capacity("claude", 900)
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready",
                          "capacity_retry_seconds": 900,
                          "capacity_retry_max_seconds": 3600}, journal, "codex", state)
            held = state.value["worker_cooldowns"]["codex"]["until"]
        # Clamped to the stated reset (~4 minutes) rather than the 900s backoff.
        self.assertLess(dt.datetime.fromisoformat(held),
                        autonomous.utc_now() + dt.timedelta(minutes=10))

    @mock.patch.object(autonomous, "load_runtime_env", return_value={"WAWALU_INGEST_ENDPOINT": "https://example.invalid"})
    @mock.patch.object(autonomous, "load_personas", return_value={"manager": {"wawalu_token": "manager-token"}})
    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_consultation_defers_when_both_providers_are_exhausted(self, github, personas, runtime):
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            consult.side_effect = autonomous.ConsultantCapacityExhausted("codex")
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_worker_capacity("claude", 900)
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, journal, "codex", state)
        self.assertIsNone(result)
        self.assertEqual(consult.call_count, 1)
        self.assertIn("consultation_capacity_deferred",
                      [call.args[0] for call in journal.emit.call_args_list])

    @mock.patch.object(autonomous, "github", return_value={"state": "closed"})
    def test_new_round_skips_a_consultant_that_is_cooling_down(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "load_personas",
                               return_value={"manager": {"wawalu_token": "token"}}), \
             mock.patch.object(autonomous, "load_runtime_env",
                               return_value={"WAWALU_INGEST_ENDPOINT": "https://ingest.invalid"}), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            consult.side_effect = RuntimeError("stop after the worker is chosen")
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_worker_capacity("codex", 900)
            self.consultation_workspace(tmp, {
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
            })
            with self.assertRaises(RuntimeError):
                autonomous.consult_after_directive_mvp(
                    "token", {"issue_label": "agent-ready"}, mock.Mock(), "codex", state)
            self.assertEqual(
                autonomous.DirectiveBook().read()[0]["consultations"][0]["worker"], "claude")
        self.assertEqual(consult.call_args.args[0], "claude")

    BACKLOG_PLAN = [
        {"persona": "staff", "title": "Fix subpaths", "outcome": "Assets load under /paint",
         "acceptance_criteria": ["No absolute paths", "Tests pass"]},
        {"persona": "frontend", "title": "Speed up first load", "outcome": "Fast first paint",
         "acceptance_criteria": ["No console errors", "Tests pass"]},
        {"persona": "staff", "title": "Trim desktop UI", "outcome": "No Electron-only controls",
         "acceptance_criteria": ["Web-only menus", "Tests pass"]},
    ]

    @mock.patch.object(autonomous, "create_generated_issue",
                       side_effect=[{"number": 40}, {"number": 41}, {"number": 42}])
    def test_directive_backlog_chains_each_persona_track_separately(self, create):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"):
            store = seed_directives({
                "status": "pending", "text": "Ship paint", "plan": self.BACKLOG_PLAN})
            issues = autonomous.generate_directive_backlog(
                "token", {"issue_label": "agent-ready"}, mock.Mock(), store.read())
        self.assertEqual([item["number"] for item in issues], [40, 41, 42])
        # Frontend starts free of the staff track; staff's second task waits on its own first.
        self.assertEqual([call.args[3] for call in create.call_args_list], [None, None, 40])

    @mock.patch.object(autonomous, "github")
    def test_legacy_single_consultation_migrates_to_a_completed_round(self, github):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "consult_next_steps") as consult:
            store = seed_directives({
                "status": "consumed", "text": "Build social",
                "created_issues": [{"index": 0, "issue": 20}],
                "consultation": {"worker": "claude", "issue": 24},
            })
            github.return_value = {"state": "open"}
            result = autonomous.consult_after_directive_mvp(
                "token", {"issue_label": "agent-ready"}, mock.Mock())
            migrated = autonomous.DirectiveBook().read()[0]
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
        self.assertEqual(submitted.args[0], f"/repos/{REPO}/pulls/40/reviews")
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
        self.assertEqual(commented.args[0], f"/repos/{REPO}/issues/40/comments")
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
        self.assertEqual(updated.args[0], f"/repos/{REPO}/pulls/40/update-branch")
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
            self.assertEqual(commented.args[0], f"/repos/{REPO}/issues/40/comments")
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
                None, None,
                {"number": 8, "labels": [{"name": "agent-running"}, {"name": "persona:staff"}]},
                None, None,
            ]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready"}, state, mock.Mock())
            record = state.value["issues"]["8"]
            self.assertEqual(record["status"], "requeued")
            # The pull reached review, so the race clears stale failures and is
            # charged to the conflict budget instead.
            self.assertEqual(record["attempts"], 0)
            self.assertEqual(record["conflict_requeues"], 1)
        closed = github.call_args_list[2]
        self.assertEqual(closed.args[0], f"/repos/{REPO}/pulls/41")
        self.assertEqual(closed.args[3], {"state": "closed"})
        deleted = github.call_args_list[3]
        self.assertEqual(deleted.args[0],
                         f"/repos/{REPO}/git/refs/heads/agent/staff/issue-8-decision-detail")
        self.assertEqual(deleted.args[2], "DELETE")
        relabeled = github.call_args_list[5]
        self.assertEqual(sorted(relabeled.args[3]["labels"]), ["agent-ready", "persona:staff"])
        commented = github.call_args_list[6]
        self.assertEqual(commented.args[0], f"/repos/{REPO}/issues/8/comments")
        self.assertIn("fresh implementation", commented.args[3]["body"])

    @mock.patch.object(autonomous, "github")
    def test_conflicted_agent_pr_with_closed_issue_only_gets_comment(self, github):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [{"mergeable_state": "dirty"}, {"state": "closed"}, None]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready"}, state, mock.Mock())
        commented = github.call_args_list[2]
        self.assertEqual(commented.args[0], f"/repos/{REPO}/issues/41/comments")
        self.assertIn("manual rebase", commented.args[3]["body"])

    def conflict_after(self, github, record, config):
        """Drive a dirty agent pull through the sweep with the given history."""
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["8"] = {"status": "submitted", "persona": "staff", **record}
            github.side_effect = [
                {"mergeable_state": "dirty"},
                {"state": "open", "number": 8,
                 "labels": [{"name": "agent-running"}, {"name": "persona:staff"}]},
                None, None,
                {"number": 8, "labels": [{"name": "agent-running"}, {"name": "persona:staff"}]},
                None, None,
            ]
            autonomous.update_pull_branch(dict(self.AGENT_PULL), "token",
                                          {"issue_label": "agent-ready", **config},
                                          state, mock.Mock())
            return dict(state.value["issues"]["8"])

    @mock.patch.object(autonomous, "github")
    def test_conflict_after_spent_attempts_requeues_instead_of_blocking(self, github):
        # An issue whose earlier attempts failed for unrelated reasons finally
        # produced an approved pull and then lost the race to `main`. Blocking it
        # here threw away finished work and waited on a human to requeue.
        record = self.conflict_after(github, {"attempts": 2}, {"max_attempts": 2})
        self.assertEqual(record["status"], "requeued")
        relabeled = github.call_args_list[5]
        self.assertIn("agent-ready", relabeled.args[3]["labels"])
        self.assertNotIn("agent-blocked", relabeled.args[3]["labels"])

    @mock.patch.object(autonomous, "github")
    def test_repeated_conflicts_still_stop_at_their_own_budget(self, github):
        record = self.conflict_after(github, {"attempts": 0, "conflict_requeues": 2},
                                     {"max_conflict_requeues": 2})
        self.assertEqual(record["status"], "blocked")
        relabeled = github.call_args_list[5]
        self.assertIn("agent-blocked", relabeled.args[3]["labels"])
        self.assertNotIn("agent-ready", relabeled.args[3]["labels"])
        self.assertIn("human attention", github.call_args_list[6].args[3]["body"])

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
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
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
                value = autonomous.DirectiveBook().read()[0]["consultations"][0]
                self.assertEqual(value.get("consult_attempts", 0), expected_attempts)
            self.assertEqual(value["worker"], "claude")

    @mock.patch.object(autonomous, "execute_issue")
    @mock.patch.object(autonomous, "resolve_worker", return_value="codex")
    @mock.patch.object(autonomous, "generate_directive_backlog")
    @mock.patch.object(autonomous, "list_ready_issues", return_value=[])
    @mock.patch.object(autonomous, "sweep_outstanding_prs")
    @mock.patch.object(autonomous, "ensure_labels")
    @mock.patch.object(autonomous, "sync_main")
    @mock.patch.object(autonomous, "installation_token", return_value="token")
    def test_each_tick_plans_one_directive_and_leaves_the_rest_pending(
            self, token, sync, labels, sweep, ready, backlog, worker, execute):
        """Two product lines can be in flight without spending two paid plans per tick."""
        backlog.side_effect = lambda *args, **kwargs: [
            {"number": 41, "labels": [{"name": "persona:product"}], "title": "Task"}]
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "STOP", pathlib.Path(tmp) / "STOP"), \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"):
            book = autonomous.DirectiveBook()
            first = book.add("Evolve the social app")
            second = book.add("Build the AI FinOps view", ["product", "design"])
            config = {"enabled": True, "working_hours": {"start": 0, "end": 24},
                      "issue_label": "agent-ready", "min_pr_interval_seconds": 0,
                      "max_attempts": 3, "retry_cooldown_seconds": 0, "default_worker": "auto"}
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            result = autonomous.tick(config, state, mock.Mock())

        self.assertEqual(result, "executed")
        # Only the first pending directive was planned this tick...
        self.assertEqual(backlog.call_count, 1)
        self.assertEqual(backlog.call_args.args[3]["id"], first["id"])
        # ...and the second is still waiting its turn, with its scope intact.
        self.assertEqual(backlog.call_args.args[3].get("personas"), None)
        self.assertEqual(second["personas"], ["product", "design"])

    @mock.patch.object(autonomous, "consult_after_directive_mvp")
    def test_consultation_advances_the_first_finished_program(self, consult):
        """A finished program consults while an unfinished one keeps waiting."""
        consult.side_effect = [None, [{"number": 55}]]
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"):
            seed_directives(
                {"status": "consumed", "text": "Unfinished", "created_issues": [{"index": 0, "issue": 20}]},
                {"status": "consumed", "text": "Finished", "created_issues": [{"index": 0, "issue": 30}]},
            )
            issues = autonomous.consult_every_directive("token", {"issue_label": "agent-ready"}, mock.Mock())

        self.assertEqual([item["number"] for item in issues], [55])
        # Each directive is offered its own consultation, in order, and the loop stops
        # at the first one that produced a program — consultations are paid runs.
        self.assertEqual(consult.call_count, 2)
        self.assertEqual([call.args[-1]["text"] for call in consult.call_args_list],
                         ["Unfinished", "Finished"])

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

    APPROVED_REVIEW = [{"state": "APPROVED", "commit_id": "def456",
                        "user": {"login": "wawalu-synthetic-reviewer[bot]"}}]

    def undelivered_agent_pull(self) -> dict:
        pull = dict(self.AGENT_PULL)
        pull.pop("auto_merge")
        return pull

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "github")
    def test_approved_team_pr_without_auto_merge_is_delivered(self, github, merge):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [[self.undelivered_agent_pull()], list(self.APPROVED_REVIEW)]
            autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            record = state.value["pr_deliveries"]["41"]
        merge.assert_called_once_with(
            autonomous.REPOSITORY, "agent/staff/issue-8-decision-detail", "token",
            pathlib.Path(tmp))
        self.assertEqual(record["sha"], "def456")

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "github")
    def test_team_pr_delivery_can_be_disabled(self, github, merge):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            github.side_effect = [[self.undelivered_agent_pull()], list(self.APPROVED_REVIEW)]
            autonomous.review_outstanding_prs(
                "token", {"deliver_approved_team_prs": False}, state, mock.Mock())
        merge.assert_not_called()

    @mock.patch.object(autonomous, "enable_auto_merge",
                       side_effect=RuntimeError("gh pr merge failed"))
    @mock.patch.object(autonomous, "github")
    def test_failed_team_delivery_stops_retrying_the_same_head(self, github, merge):
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            for _ in range(autonomous.DELIVERY_ATTEMPT_LIMIT + 2):
                github.side_effect = [[self.undelivered_agent_pull()], list(self.APPROVED_REVIEW)]
                autonomous.review_outstanding_prs("token", {}, state, journal)
            attempts = state.value["pr_deliveries"]["41"]["attempts"]
        self.assertEqual(merge.call_count, autonomous.DELIVERY_ATTEMPT_LIMIT)
        self.assertEqual(attempts, autonomous.DELIVERY_ATTEMPT_LIMIT)
        self.assertEqual(
            [call.args[0] for call in journal.emit.call_args_list],
            ["team_pr_auto_merge_failed"] * autonomous.DELIVERY_ATTEMPT_LIMIT)

    @mock.patch.object(autonomous, "enable_auto_merge")
    @mock.patch.object(autonomous, "github")
    def test_delivery_retries_after_the_worker_pushes_a_new_head(self, github, merge):
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["pr_deliveries"]["41"] = {
                "sha": "old-sha", "attempts": autonomous.DELIVERY_ATTEMPT_LIMIT,
                "at": "2026-07-25T00:00:00+00:00"}
            github.side_effect = [[self.undelivered_agent_pull()], list(self.APPROVED_REVIEW)]
            autonomous.review_outstanding_prs("token", {}, state, mock.Mock())
            record = state.value["pr_deliveries"]["41"]
        merge.assert_called_once()
        self.assertEqual((record["sha"], record["attempts"]), ("def456", 1))

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
        # isolate from the machine's real stop flag — a stopped live daemon
        # must not change what this test observes
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(autonomous, "STOP", pathlib.Path(tmp) / "stop"):
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

    @mock.patch.object(autonomous, "github")
    def test_state_label_reads_current_labels_instead_of_the_run_start_snapshot(self, github):
        stale = {"number": 152, "labels": [{"name": "agent-ready"}, {"name": "persona:security"}]}
        github.return_value = {"number": 152, "labels": [{"name": "paused"},
                                                         {"name": "persona:security"}]}
        autonomous.replace_state_label("token", stale, "agent-ready", None, keep_ready=True)
        patched = github.call_args.args[3]["labels"]
        self.assertIn("paused", patched)
        self.assertNotIn("agent-ready", patched)

    @mock.patch.object(autonomous, "github")
    def test_state_label_keeps_a_paused_issue_out_of_the_ready_queue(self, github):
        issue = {"number": 152, "labels": [{"name": "paused"}, {"name": "agent-running"}]}
        github.return_value = issue
        autonomous.replace_state_label("token", issue, "agent-ready", "agent-ready", keep_ready=True)
        self.assertEqual(github.call_args.args[3]["labels"], ["paused"])

    def test_choose_issue_skips_owner_paused_issues(self):
        paused = {"number": 152, "labels": [{"name": "agent-ready"}, {"name": "paused"},
                                            {"name": "persona:security"}], "body": ""}
        ready = {"number": 153, "labels": [{"name": "agent-ready"},
                                           {"name": "persona:security"}], "body": ""}
        config = {"retry_cooldown_seconds": 60, "max_attempts": 3, "min_pr_interval_seconds": 0,
                  "persona_work_windows": {}, "working_hours": {"start": 0, "end": 24}}
        state = mock.Mock()
        state.value = {"issues": {}}
        state.persona_available.return_value = True
        chosen = autonomous.choose_issue([paused, ready], state, config, autonomous.utc_now())
        self.assertEqual(chosen["number"], 153)

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

    def test_capacity_exit_codes_map_to_the_exhausted_provider(self):
        self.assertEqual(autonomous.CAPACITY_WORKERS[75], "codex")
        self.assertEqual(autonomous.CAPACITY_WORKERS[76], "claude")

    def test_auto_worker_routes_around_a_capacity_exhausted_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            self.assertEqual(autonomous.resolve_worker("auto", state), "auto")
            state.record_worker_capacity("claude", 900)
            self.assertEqual(autonomous.resolve_worker("auto", state), "codex")
            self.assertEqual(autonomous.resolve_worker("claude", state), "codex")
            self.assertEqual(autonomous.resolve_worker("codex", state), "codex")

    def test_worker_cooldown_expires_and_restores_auto_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_worker_capacity("claude", 900)
            later = autonomous.utc_now() + dt.timedelta(seconds=901)
            self.assertTrue(state.worker_available("claude", later))
            self.assertEqual(autonomous.resolve_worker("auto", state, later), "auto")

    def test_repeated_capacity_exhaustion_extends_the_provider_cooldown(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            now = autonomous.utc_now()
            first = state.record_worker_capacity("claude", 900, now, maximum_seconds=18000)
            second = state.record_worker_capacity(
                "claude", 900, now + dt.timedelta(seconds=1000), maximum_seconds=18000)
            self.assertEqual([first, second], [900, 1800])
            # A session limit outlives one issue's backoff, so the second hold is longer.
            self.assertFalse(state.worker_available("claude", now + dt.timedelta(seconds=2500)))
            self.assertTrue(state.worker_available("claude", now + dt.timedelta(seconds=2900)))

    def test_a_recovered_provider_restarts_the_capacity_backoff(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            now = autonomous.utc_now()
            state.record_worker_capacity("claude", 900, now, maximum_seconds=3600)
            quiet = now + dt.timedelta(seconds=3601)
            self.assertEqual(
                state.record_worker_capacity("claude", 900, quiet, maximum_seconds=3600), 900)

    def test_legacy_string_worker_cooldowns_are_still_honoured(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            now = autonomous.utc_now()
            state.value["worker_cooldowns"]["claude"] = (now + dt.timedelta(seconds=60)).isoformat()
            self.assertFalse(state.worker_available("claude", now))
            self.assertTrue(state.worker_available("claude", now + dt.timedelta(seconds=61)))

    def test_no_worker_is_selected_when_every_provider_is_exhausted(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.record_worker_capacity("claude", 900)
            state.record_worker_capacity("codex", 900)
            self.assertIsNone(autonomous.resolve_worker("auto", state))

    def http_error(self, url, code, reason):
        """An HTTPError that releases its backing temp file when the test ends."""
        error = urllib.error.HTTPError(url, code, reason, {}, None)
        self.addCleanup(error.close)
        return error

    def expired_then_ok(self, payload=b'{"ok": true}'):
        """A urlopen stub that 401s on the stale token and succeeds on any other."""
        calls = []

        def urlopen(request, timeout=None):
            token = request.headers["Authorization"].removeprefix("Bearer ")
            calls.append(token)
            if token == "stale":
                raise self.http_error(request.full_url, 401, "Unauthorized")
            response = mock.MagicMock()
            response.length = len(payload)
            response.read.return_value = payload
            response.__enter__.return_value = response
            return response

        return urlopen, calls

    def test_github_call_survives_a_token_that_expired_during_a_long_run(self):
        urlopen, calls = self.expired_then_ok()
        with mock.patch.object(github_app, "_SCOPES", {}), \
             mock.patch.object(github_app, "_REPLACED", {}), \
             mock.patch.object(github_app, "installation_token", return_value="fresh"), \
             mock.patch.object(autonomous.urllib.request, "urlopen", urlopen):
            self.assertEqual(autonomous.github("/rate_limit", "stale"), {"ok": True})
            self.assertEqual(calls, ["stale", "fresh"])
            # A caller still holding the dead token transparently gets the successor.
            self.assertEqual(autonomous.github("/rate_limit", "stale"), {"ok": True})
            self.assertEqual(calls, ["stale", "fresh", "fresh"])

    def test_pull_diff_survives_an_expired_token(self):
        urlopen, calls = self.expired_then_ok(b"diff --git a/a b/a")
        with mock.patch.object(github_app, "_SCOPES", {}), \
             mock.patch.object(github_app, "_REPLACED", {}), \
             mock.patch.object(github_app, "installation_token", return_value="fresh"), \
             mock.patch.object(autonomous.urllib.request, "urlopen", urlopen):
            self.assertEqual(autonomous.fetch_pull_diff(7, "stale"), "diff --git a/a b/a")
            self.assertEqual(calls, ["stale", "fresh"])

    def test_non_auth_errors_are_not_retried_with_a_new_token(self):
        def urlopen(request, timeout=None):
            raise self.http_error(request.full_url, 404, "Not Found")

        with mock.patch.object(github_app, "_SCOPES", {}), \
             mock.patch.object(github_app, "_REPLACED", {}), \
             mock.patch.object(github_app, "installation_token") as mint, \
             mock.patch.object(autonomous.urllib.request, "urlopen", urlopen):
            with self.assertRaises(urllib.error.HTTPError):
                autonomous.github("/missing", "stale")
            mint.assert_not_called()

    def test_refreshed_token_keeps_the_scope_it_was_minted_with(self):
        with mock.patch.object(github_app, "_SCOPES", {"stale": ("paint-lab", "github-reviewer-app", {"x": "y"})}), \
             mock.patch.object(github_app, "_REPLACED", {}), \
             mock.patch.object(github_app, "installation_token", return_value="fresh") as mint:
            self.assertEqual(github_app.refresh_token("stale"), "fresh")
            mint.assert_called_once_with("paint-lab", "github-reviewer-app", {"x": "y"})

    def test_token_memory_is_bounded(self):
        with mock.patch.object(github_app, "_SCOPES", {}), \
             mock.patch.object(github_app, "_REPLACED", {}):
            for index in range(github_app._REMEMBERED * 3):
                github_app._remember(f"token-{index}", ("repo", "github-app", None))
            self.assertEqual(len(github_app._SCOPES), github_app._REMEMBERED)

    def test_worktree_is_cleaned_even_when_bookkeeping_fails(self):
        """A GitHub outage after the run must not strand the worktree the retry needs."""
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            issue = {"number": 23, "title": "Touch drawing", "body": "",
                     "labels": [{"name": "persona:backend"}]}
            with mock.patch.object(autonomous, "replace_state_label"), \
                 mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "run_worker_process", return_value=0), \
                 mock.patch.object(autonomous, "record_run_outcome",
                                   side_effect=RuntimeError("github is down")), \
                 mock.patch.object(autonomous, "cleanup_worktree") as cleanup:
                with self.assertRaisesRegex(RuntimeError, "github is down"):
                    autonomous.execute_issue(issue, {**self.config(), "issue_label": "agent-ready",
                                                     "default_worker": "codex",
                                                     "worker_timeout_seconds": 10},
                                             state, autonomous.Journal(pathlib.Path(tmp) / "events.jsonl"),
                                             "token")
                cleanup.assert_called_once()

    def test_outcome_is_recorded_when_github_notification_fails(self):
        """A DNS blip while commenting must not swallow the run's terminal event."""
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 1}
            events = pathlib.Path(tmp) / "events.jsonl"
            journal = autonomous.Journal(events)
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}, {"name": "agent-running"}]}
            outage = urllib.error.URLError("nodename nor servname provided")
            with mock.patch.object(autonomous, "comment", side_effect=outage), \
                 mock.patch.object(autonomous, "replace_state_label", side_effect=outage):
                autonomous.record_run_outcome(
                    76, issue, 60, "frontend", {}, {**self.config(), "issue_label": "agent-ready"},
                    state, journal, "token")
            emitted = [json.loads(line)["event"] for line in events.read_text().splitlines()]
            self.assertIn("run_capacity_deferred", emitted)
            self.assertIn("github_bookkeeping_failed", emitted)
            self.assertEqual(state.value["issues"]["60"]["status"], "retry")
            self.assertEqual(state.value["issues"]["60"]["worker_override"], "codex")

    def test_rejection_feedback_is_carried_onto_the_issue_record(self):
        """A rejected attempt must hand its blocking note to the next one.

        Issues 396 and 399 each burned successive paid sessions earning the same
        rejection twice, because the retry replanned from the issue body alone and
        never learned what the reviewer had asked for.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 1}
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}]}
            with mock.patch.object(autonomous, "latest_run_review", return_value="Panels are not wired."), \
                 mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label"):
                autonomous.record_run_outcome(
                    orchestrator.REVIEW_REJECTED_EXIT_CODE, issue, 60, "frontend", {},
                    {**self.config(), "issue_label": "agent-ready"}, state, journal, "token")
            self.assertEqual(state.value["issues"]["60"]["review_feedback"], "Panels are not wired.")

    def test_only_a_rejection_records_review_feedback(self):
        """A crash or a capacity defer says nothing about the work — nothing to carry."""
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 1}
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}]}
            with mock.patch.object(autonomous, "latest_run_review", return_value="stale note"), \
                 mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label"):
                autonomous.record_run_outcome(
                    1, issue, 60, "frontend", {}, {**self.config(), "issue_label": "agent-ready"},
                    state, journal, "token")
            self.assertNotIn("review_feedback", state.value["issues"]["60"])

    def test_policy_rejection_is_carried_onto_the_issue_record(self):
        """An oversized change is discarded whole, so the retry must be told to shrink.

        Issue 448 lost a full paid session by exceeding the diff ceiling by ten lines,
        then replanned from the issue body alone with no idea the ceiling had fired.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 1}
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}]}
            with mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label"):
                run_dir = pathlib.Path(tmp) / ".agent" / "runs" / "sim_1"
                run_dir.mkdir(parents=True)
                (run_dir / orchestrator.POLICY_REJECTION_FILE).write_text(
                    "policy: 2010 changed lines exceeds limit 2000\n")
                with mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
                    autonomous.record_run_outcome(
                        orchestrator.POLICY_REJECTED_EXIT_CODE, issue, 60, "frontend", {},
                        {**self.config(), "issue_label": "agent-ready"}, state, journal, "token")
            carried = state.value["issues"]["60"]["review_feedback"]
            self.assertIn("2010 changed lines exceeds limit 2000", carried)
            self.assertIn("smallest change", carried)

    def test_latest_run_policy_rejection_is_empty_without_a_rejection_file(self):
        """A run that passed the gate leaves no note, and none must be invented."""
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = pathlib.Path(tmp) / ".agent" / "runs" / "sim_1"
            run_dir.mkdir(parents=True)
            with mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
                self.assertEqual(autonomous.latest_run_policy_rejection(), "")

    def test_latest_run_review_ignores_an_approved_verdict(self):
        """Only a withheld approval carries advice; an approval must not leak forward."""
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = pathlib.Path(tmp) / ".agent" / "runs" / "sim_1"
            run_dir.mkdir(parents=True)
            (run_dir / "review.json").write_text(
                json.dumps({"approved": True, "feedback": "nit: rename x", "summary": "ok"}))
            with mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)):
                self.assertEqual(autonomous.latest_run_review(), "")
                (run_dir / "review.json").write_text(
                    json.dumps({"approved": False, "feedback": "Panels are not wired.", "summary": "s"}))
                self.assertEqual(autonomous.latest_run_review(), "Panels are not wired.")

    def test_capacity_backoff_is_short_while_the_alternate_provider_is_awake(self):
        """One dark provider is not a reason to idle: the long backoff is for both dark.

        With a live alternate the retry already routes around the exhausted provider,
        so an hour-long wait buys nothing and costs the team an hour of throughput.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 3,
                                           "capacity_failures": 6}
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}]}
            config = {**self.config(), "issue_label": "agent-ready",
                      "capacity_retry_seconds": 900, "capacity_retry_max_seconds": 3600,
                      "retry_cooldown_seconds": 300}
            with mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label"):
                # Exit 75 is codex; claude has no cooldown recorded, so it is awake.
                autonomous.record_run_outcome(75, issue, 60, "frontend", {}, config,
                                              state, journal, "token")
            record = state.value["issues"]["60"]
            self.assertEqual(record["worker_override"], "claude")
            wait = (dt.datetime.fromisoformat(record["retry_at"])
                    - autonomous.utc_now()).total_seconds()
            self.assertLessEqual(wait, 300)
            # The exhausted provider is still held out, and no attempt was consumed.
            self.assertFalse(state.worker_available("codex"))
            self.assertEqual(record["attempts"], 2)

    def test_capacity_backoff_stays_long_when_both_providers_are_dark(self):
        """Nowhere to go: keep the exponential backoff rather than hammering a wall."""
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["60"] = {"status": "running", "attempts": 3,
                                           "capacity_failures": 6}
            state.record_worker_capacity("claude", 900, maximum_seconds=3600)
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            issue = {"number": 60, "title": "Share button", "body": "",
                     "labels": [{"name": "agent-ready"}]}
            config = {**self.config(), "issue_label": "agent-ready",
                      "capacity_retry_seconds": 900, "capacity_retry_max_seconds": 3600,
                      "retry_cooldown_seconds": 300}
            with mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label"):
                autonomous.record_run_outcome(75, issue, 60, "frontend", {}, config,
                                              state, journal, "token")
            wait = (dt.datetime.fromisoformat(state.value["issues"]["60"]["retry_at"])
                    - autonomous.utc_now()).total_seconds()
            self.assertGreater(wait, 300)

    def test_spent_diff_budget_defers_without_consuming_an_attempt(self):
        """A spent daily rail is not a defect: it must not march issues to agent-blocked.

        The rail is global, so charging an attempt would blockade every issue the
        exhausted budget touched, not just the one that happened to run.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["194"] = {"status": "running", "attempts": 2}
            events = pathlib.Path(tmp) / "events.jsonl"
            journal = autonomous.Journal(events)
            issue = {"number": 194, "title": "Benchmarks", "body": "",
                     "labels": [{"name": "agent-ready"}, {"name": "agent-running"}]}
            with mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label") as label:
                autonomous.record_run_outcome(
                    orchestrator.DIFF_BUDGET_EXIT_CODE, issue, 194, "product", {},
                    {**self.config(), "issue_label": "agent-ready", "max_attempts": 2},
                    state, journal, "token")
            emitted = [json.loads(line)["event"] for line in events.read_text().splitlines()]
            self.assertIn("run_diff_budget_deferred", emitted)
            self.assertNotIn("run_failed", emitted)
            record = state.value["issues"]["194"]
            self.assertEqual(record["status"], "retry")
            self.assertEqual(record["attempts"], 1)
            self.assertTrue(label.call_args.kwargs["keep_ready"])

    def test_provider_overload_defers_without_consuming_an_attempt(self):
        """A 529 wave is the provider's outage, not a defect in the work.

        With one provider capped, charging an attempt would walk every issue an
        outage touched to agent-blocked within max_attempts runs.
        """
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            state.value["issues"]["297"] = {"status": "running", "attempts": 2}
            events = pathlib.Path(tmp) / "events.jsonl"
            journal = autonomous.Journal(events)
            issue = {"number": 297, "title": "Recoverable spend", "body": "",
                     "labels": [{"name": "agent-ready"}, {"name": "agent-running"}]}
            with mock.patch.object(autonomous, "comment"), \
                 mock.patch.object(autonomous, "replace_state_label") as label:
                autonomous.record_run_outcome(
                    autonomous.PROVIDER_OVERLOAD_EXIT_CODE, issue, 297, "backend", {},
                    {**self.config(), "issue_label": "agent-ready", "max_attempts": 2,
                     "retry_cooldown_seconds": 300},
                    state, journal, "token")
            emitted = [json.loads(line)["event"] for line in events.read_text().splitlines()]
            self.assertIn("run_provider_overload_deferred", emitted)
            self.assertNotIn("run_failed", emitted)
            record = state.value["issues"]["297"]
            self.assertEqual(record["status"], "retry")
            self.assertEqual(record["attempts"], 1)
            self.assertNotIn("worker_override", record)
            self.assertTrue(label.call_args.kwargs["keep_ready"])

    def test_tick_stops_starting_runs_when_the_daily_diff_rail_is_spent(self):
        config = {**self.config(), "enabled": True, "issue_label": "agent-ready",
                  "working_hours": {"start": 0, "end": 24}, "daily_diff_limit": 3}
        with tempfile.TemporaryDirectory() as tmp:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            for index in range(3):
                autonomous.BUDGET.record({"run_id": f"sim_{index}"})
            with mock.patch.object(autonomous, "sync_main"), \
                 mock.patch.object(autonomous, "ensure_labels"), \
                 mock.patch.object(autonomous, "sweep_outstanding_prs"), \
                 mock.patch.object(autonomous, "post_stakeholder_reviews"), \
                 mock.patch.object(autonomous, "list_ready_issues", return_value=[]), \
                 mock.patch.object(autonomous, "start_run") as start:
                result = autonomous.tick(config, state, journal, token="token")
            self.assertEqual(result, "diff-budget-exhausted")
            start.assert_not_called()

    def test_stale_worktree_is_reclaimed_instead_of_failing_the_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            worktree = pathlib.Path(tmp) / "backend-issue-23"
            worktree.mkdir()
            (worktree / "leftover.txt").write_text("debris")
            with mock.patch.object(orchestrator.subprocess, "run") as sub:
                orchestrator.reclaim_worktree(worktree, "agent/backend/issue-23")
            self.assertFalse(worktree.exists())
            self.assertIn(["git", "worktree", "remove", "--force", str(worktree)],
                          [call.args[0] for call in sub.call_args_list])

    def test_launch_agent_path_includes_user_cli_directory(self):
        value = launch_path(pathlib.Path("/Users/demo"))
        self.assertEqual(value.split(":"), [
            "/Users/demo/.local/bin", "/opt/homebrew/bin", "/usr/local/bin",
            "/usr/bin", "/bin", "/usr/sbin", "/sbin",
        ])


class StakeholderLoopTests(unittest.TestCase):
    CONFIG = {"issue_label": "agent-ready", "stakeholder_reviews": [
        {"persona": "sales", "role": "sales", "lens": "sellability",
         "assign_to": ["frontend"], "max_daily": 1, "min_interval_seconds": 0},
    ]}

    def test_reviews_file_tasks_and_respect_the_daily_cap(self):
        created = []

        def fake_github(path, token, method="GET", payload=None):
            if method == "POST" and path.endswith("/issues"):
                created.append(payload)
                return {"number": 100 + len(created)}
            return []

        review = {"feedback": "No way to raise a hand.",
                  "tasks": [{"persona": "frontend", "title": "Add a contact form",
                             "outcome": "Leads can reach us",
                             "acceptance_criteria": ["Form renders", "Tests pass"]}]}
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
                 mock.patch.object(autonomous, "github", side_effect=fake_github), \
                 mock.patch.object(autonomous, "delivered_work_context", return_value=[]), \
                 mock.patch.object(autonomous, "snapshot_live_site", return_value=None), \
                 mock.patch.object(autonomous, "load_runtime_env", return_value={}), \
                 mock.patch.object(autonomous, "stakeholder_prompt", return_value="You are Sasha"), \
                 mock.patch.object(autonomous, "stakeholder_review", return_value=review) as reviewer:
                state = autonomous.State(pathlib.Path(tmp) / "state.json")
                now = autonomous.utc_now()
                autonomous.post_stakeholder_reviews("token", self.CONFIG, state, journal, now)
                autonomous.post_stakeholder_reviews("token", self.CONFIG, state, journal, now)
        self.assertEqual(reviewer.call_count, 1)  # second call hit the daily cap
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0]["labels"], ["agent-ready", "persona:frontend"])
        self.assertIn("Sasha · sales feedback", created[0]["body"])
        self.assertIn("No way to raise a hand.", created[0]["body"])
        posted = [call.args[0] for call in journal.emit.call_args_list]
        self.assertEqual(posted.count("stakeholder_review_posted"), 1)

    def test_cadence_is_claimed_before_the_slow_review_runs(self):
        """A tick that starts while a review is still running must not fire a second one.

        The review itself takes tens of seconds, so a second tick — or a leftover
        daemon after a restart — asks 'is this stakeholder due?' before the review in
        flight has finished. Claiming the slot up front is what keeps a day's worth of
        stakeholder feedback from landing in one burst at the day rollover.
        """
        config = {"issue_label": "agent-ready", "stakeholder_reviews": [
            {"persona": "sales", "role": "sales", "lens": "sellability",
             "assign_to": ["frontend"], "max_daily": 4, "min_interval_seconds": 14400},
        ]}
        review = {"feedback": "f", "tasks": []}
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
                 mock.patch.object(autonomous, "github", return_value=[]), \
                 mock.patch.object(autonomous, "delivered_work_context", return_value=[]), \
                 mock.patch.object(autonomous, "snapshot_live_site", return_value=None), \
                 mock.patch.object(autonomous, "load_runtime_env", return_value={}), \
                 mock.patch.object(autonomous, "stakeholder_prompt", return_value="You are Sasha"), \
                 mock.patch.object(autonomous, "stakeholder_review", return_value=review) as reviewer:
                state = autonomous.State(pathlib.Path(tmp) / "state.json")
                now = autonomous.utc_now()
                for tick in range(3):  # ticks 90s apart, well inside the four-hour cadence
                    autonomous.post_stakeholder_reviews(
                        "token", config, state, journal,
                        now + dt.timedelta(seconds=90 * tick))
        self.assertEqual(reviewer.call_count, 1)

    def test_a_failed_review_gives_its_daily_slot_back(self):
        config = {"issue_label": "agent-ready", "stakeholder_reviews": [
            {"persona": "sales", "role": "sales", "lens": "sellability",
             "assign_to": ["frontend"], "max_daily": 2, "min_interval_seconds": 0},
        ]}
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
                 mock.patch.object(autonomous, "github", return_value=[]), \
                 mock.patch.object(autonomous, "delivered_work_context", return_value=[]), \
                 mock.patch.object(autonomous, "snapshot_live_site", return_value=None), \
                 mock.patch.object(autonomous, "load_runtime_env", return_value={}), \
                 mock.patch.object(autonomous, "stakeholder_prompt", return_value="You are Sasha"), \
                 mock.patch.object(autonomous, "stakeholder_review",
                                   side_effect=RuntimeError("qwen down")):
                state = autonomous.State(pathlib.Path(tmp) / "state.json")
                autonomous.post_stakeholder_reviews(
                    "token", config, state, journal := mock.Mock(), autonomous.utc_now())
                self.assertEqual(state.value["stakeholder_reviews"]["sales"]["count"], 0)
        self.assertIn("stakeholder_review_failed",
                      [call.args[0] for call in journal.emit.call_args_list])

    def test_review_failure_is_journaled_not_fatal(self):
        journal = mock.Mock()
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
                 mock.patch.object(autonomous, "github", return_value=[]), \
                 mock.patch.object(autonomous, "delivered_work_context", return_value=[]), \
                 mock.patch.object(autonomous, "snapshot_live_site", return_value=None), \
                 mock.patch.object(autonomous, "load_runtime_env", return_value={}), \
                 mock.patch.object(autonomous, "stakeholder_prompt", return_value="You are Sasha"), \
                 mock.patch.object(autonomous, "stakeholder_review",
                                   side_effect=RuntimeError("qwen down")):
                state = autonomous.State(pathlib.Path(tmp) / "state.json")
                autonomous.post_stakeholder_reviews(
                    "token", self.CONFIG, state, journal, autonomous.utc_now())
        events = [call.args[0] for call in journal.emit.call_args_list]
        self.assertIn("stakeholder_review_failed", events)


class ParallelRunTests(IsolatedDiffBudget):
    """Several issues in flight at once, without the runs overwriting each other."""

    CONFIG = {"enabled": True, "issue_label": "agent-ready", "max_attempts": 3,
              "retry_cooldown_seconds": 60, "min_pr_interval_seconds": 0,
              "default_worker": "codex", "worker_timeout_seconds": 10,
              "working_hours": {"start": 0, "end": 24}}

    def issue(self, number, persona):
        return {"number": number, "title": f"Task {number}", "body": "",
                "labels": [{"name": "agent-ready"}, {"name": f"persona:{persona}"}]}

    def test_concurrent_runs_do_not_lose_each_others_records(self):
        """Two engineers finishing at once must both be recorded, not last-write-wins.

        Both runs hold a State loaded before either wrote anything, which is exactly
        the situation a long run is in when a shorter one finishes underneath it.
        """
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "ROOT", pathlib.Path(tmp)), \
             mock.patch.object(autonomous, "AUTONOMY", pathlib.Path(tmp) / "autonomy"), \
             mock.patch.object(autonomous, "replace_state_label"), \
             mock.patch.object(autonomous, "comment"), \
             mock.patch.object(autonomous, "cleanup_worktree"):
            path = pathlib.Path(tmp) / "state.json"
            journal = autonomous.Journal(pathlib.Path(tmp) / "events.jsonl")
            work = [(101, "backend", autonomous.State(path)),
                    (102, "frontend", autonomous.State(path))]
            inside = threading.Barrier(len(work))

            def worker_process(command, timeout_seconds, emitter, number):
                inside.wait(10)  # both runs are mid-flight before either records anything
                return 0

            failures = []

            def execute(number, persona, state):
                try:
                    autonomous.execute_issue(self.issue(number, persona), self.CONFIG,
                                             state, journal, "token")
                except Exception as error:  # surfaced below, not swallowed by the thread
                    failures.append(error)

            with mock.patch.object(autonomous, "run_worker_process", side_effect=worker_process):
                threads = [threading.Thread(target=execute, args=item) for item in work]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join(20)
            self.assertEqual(failures, [])
            value = json.loads(path.read_text())

        self.assertEqual(value["issues"]["101"]["status"], "submitted")
        self.assertEqual(value["issues"]["102"]["status"], "submitted")
        self.assertEqual(value["issues"]["101"]["attempts"], 1)
        self.assertEqual(value["issues"]["102"]["attempts"], 1)
        # Both engineers are spaced out for their next pull request; a run may also
        # record the collaborator it paired with, so this is a subset check.
        self.assertLessEqual({"backend", "frontend"}, set(value["persona_submissions"]))
        # The daily tally is a read-modify-write of its own: neither run may be lost.
        self.assertEqual(sum(value["daily_runs"].values()), 2)

    def test_hand_edited_requeue_survives_a_running_run(self):
        """Requeuing by hand mid-run must keep working: the run re-reads before it writes."""
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(autonomous, "replace_state_label"), \
             mock.patch.object(autonomous, "comment"):
            path = pathlib.Path(tmp) / "state.json"
            seed = autonomous.State(path)
            with seed.mutate():
                seed.value["issues"]["7"] = {"status": "running", "attempts": 1}
                seed.value["issues"]["9"] = {"status": "blocked", "attempts": 3}
            running = autonomous.State(path)  # the run thread's handle, loaded now
            edited = json.loads(path.read_text())
            edited["issues"].pop("9")  # the owner requeues #9 while the run works
            path.write_text(json.dumps(edited), encoding="utf-8")

            autonomous.record_run_outcome(
                0, self.issue(7, "backend"), 7, "backend", {}, self.CONFIG, running,
                autonomous.Journal(pathlib.Path(tmp) / "events.jsonl"), "token")
            value = json.loads(path.read_text())

        self.assertEqual(value["issues"]["7"]["status"], "submitted")
        self.assertNotIn("9", value["issues"])

    def test_journal_lines_from_many_threads_stay_whole(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "events.jsonl"
            journal = autonomous.Journal(path)

            def emit(number):
                for index in range(20):
                    journal.emit("run_started", issue=number, detail="x" * 600, index=index)

            threads = [threading.Thread(target=emit, args=(number,)) for number in range(8)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(20)
            lines = path.read_text(encoding="utf-8").splitlines()

        self.assertEqual(len(lines), 160)
        self.assertEqual({json.loads(line)["event"] for line in lines}, {"run_started"})

    def test_registry_refuses_a_second_claim_and_frees_it_when_the_run_ends(self):
        runs = autonomous.RunRegistry()
        release = threading.Event()
        self.assertTrue(runs.start(11, "backend", release.wait))
        self.assertFalse(runs.start(12, "backend", release.wait))  # same engineer
        self.assertFalse(runs.start(11, "frontend", release.wait))  # same issue
        self.assertTrue(runs.start(13, "frontend", release.wait))
        self.assertEqual(runs.active(), {11: "backend", 13: "frontend"})
        release.set()
        runs.join(10)
        self.assertEqual(len(runs), 0)
        self.assertTrue(runs.start(12, "backend", release.wait))
        runs.join(10)

    def test_a_failing_run_thread_is_journaled_and_releases_its_persona(self):
        with tempfile.TemporaryDirectory() as tmp:
            journal = mock.Mock()
            runs = autonomous.RunRegistry()
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            with mock.patch.object(autonomous, "execute_issue",
                                   side_effect=RuntimeError("worker exploded")):
                self.assertTrue(autonomous.start_run(self.issue(21, "backend"), self.CONFIG,
                                                     state, journal, "token", runs))
                runs.join(10)
        self.assertEqual(len(runs), 0)
        self.assertIn("run_thread_error", [call.args[0] for call in journal.emit.call_args_list])

    @contextlib.contextmanager
    def daemon(self, tmp, max_concurrent):
        """A tick environment with the network, git, and the directive book stubbed out."""
        with mock.patch.object(autonomous, "STOP", pathlib.Path(tmp) / "STOP"), \
             mock.patch.object(autonomous, "DIRECTIVE", pathlib.Path(tmp) / "directive.json"), \
             mock.patch.object(autonomous, "DIRECTIVES", pathlib.Path(tmp) / "directives.json"), \
             mock.patch.object(autonomous, "installation_token", return_value="token"), \
             mock.patch.object(autonomous, "resolve_worker", return_value="codex"), \
             mock.patch.object(autonomous, "sweep_outstanding_prs"), \
             mock.patch.object(autonomous, "ensure_labels"), \
             mock.patch.object(autonomous, "sync_main"):
            yield {**self.CONFIG, "max_concurrent_runs": max_concurrent}

    @contextlib.contextmanager
    def held_runs(self):
        """Hold every started run open, so a later tick sees it in flight.

        Yields the gate that frees them. No tick may run outside this block: a real
        ``execute_issue`` would launch a worker against the live repository.
        """
        gate = threading.Event()
        with mock.patch.object(autonomous, "execute_issue",
                               side_effect=lambda *a, **k: gate.wait(20)):
            try:
                yield gate
            finally:
                gate.set()

    def test_tick_refuses_a_second_concurrent_run_for_one_persona(self):
        """A persona is one person: their second issue waits, someone else's does not."""
        queue = [self.issue(31, "backend"), self.issue(32, "backend"),
                 self.issue(33, "frontend")]
        with tempfile.TemporaryDirectory() as tmp, \
             self.daemon(tmp, max_concurrent=3) as config, \
             mock.patch.object(autonomous, "list_ready_issues", return_value=queue):
            runs = autonomous.RunRegistry()
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            journal = mock.Mock()
            with self.held_runs() as gate:
                first = autonomous.tick(config, state, journal, runs=runs)
                second = autonomous.tick(config, state, journal, runs=runs)
                active = runs.active()
                gate.set()
                runs.join(20)

        self.assertEqual([first, second], ["executed", "executed"])
        # Rowan carries #31, so #32 waits for him; Mina is free, so #33 starts.
        self.assertEqual(active, {31: "backend", 33: "frontend"})

    def test_one_concurrent_run_keeps_the_team_sequential(self):
        queue = [self.issue(41, "backend"), self.issue(42, "frontend")]
        with tempfile.TemporaryDirectory() as tmp, \
             self.daemon(tmp, max_concurrent=1) as config, \
             mock.patch.object(autonomous, "list_ready_issues", return_value=queue):
            runs = autonomous.RunRegistry()
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            journal = mock.Mock()
            with self.held_runs() as gate:
                first = autonomous.tick(config, state, journal, runs=runs)
                second = autonomous.tick(config, state, journal, runs=runs)
                held = runs.active()
                # The tick was not blocked by the run: it kept serving the rest of the team.
                third = autonomous.tick({**config, "max_concurrent_runs": 2},
                                        state, journal, runs=runs)
                gate.set()
                runs.join(20)
                after = autonomous.tick(config, state, journal, runs=runs)
                runs.join(20)

        self.assertEqual([first, second], ["executed", "run-slots-full"])
        self.assertEqual(held, {41: "backend"})
        # Only the configured limit was holding #42 back, not the queue or the personas.
        self.assertEqual(third, "executed")
        self.assertEqual(after, "executed")

    def test_the_next_consultation_is_asked_even_when_filler_work_is_queued(self):
        """A non-empty ready queue must not postpone the next directive round.

        Stakeholder reviews file a steady trickle of legitimate work, so the queue is
        essentially never empty. Asking for the next round only after it drained left
        product direction to advance on the accident of every persona being
        rate-limited at once. The round is self-gating, so asking every tick is free.
        """
        queue = [self.issue(51, "backend")]
        fresh = [self.issue(52, "frontend")]
        with tempfile.TemporaryDirectory() as tmp, \
             self.daemon(tmp, max_concurrent=1) as config, \
             mock.patch.object(autonomous, "list_ready_issues", return_value=queue), \
             mock.patch.object(autonomous, "consult_every_directive",
                               return_value=fresh) as consult:
            state = autonomous.State(pathlib.Path(tmp) / "state.json")
            runs = autonomous.RunRegistry()
            with self.held_runs() as gate:
                result = autonomous.tick({**config, "consult_after_directive_mvp": True},
                                         state, mock.Mock(), runs=runs)
                started = runs.active()
                gate.set()
                runs.join(20)

        self.assertEqual(result, "executed")
        consult.assert_called_once()
        # The freshly consulted program is what runs, not the queued filler.
        self.assertEqual(started, {52: "frontend"})


class SyncMainTests(unittest.TestCase):
    """sync_main against a real git checkout, since its whole job is git behaviour."""

    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = pathlib.Path(directory.name)
        self.origin = root / "origin"
        self.checkout = root / "checkout"
        self.git("init", "--bare", "--initial-branch=main", str(self.origin), cwd=root)
        self.git("clone", str(self.origin), str(self.checkout), cwd=root)
        self.git("config", "user.email", "test@example.com")
        self.git("config", "user.name", "Test")
        self.commit("first")
        self.git("push", "origin", "main")
        self.addCleanup(setattr, autonomous, "PRODUCT_ROOT", autonomous.PRODUCT_ROOT)
        autonomous.PRODUCT_ROOT = self.checkout
        self.events = []

    def git(self, *args, cwd=None):
        subprocess.run(["git", *args], cwd=cwd or self.checkout, check=True, capture_output=True)

    def commit(self, name):
        (self.checkout / name).write_text(name, encoding="utf-8")
        self.git("add", name)
        self.git("commit", "-m", name)

    def head(self, ref):
        return subprocess.check_output(["git", "rev-parse", ref], cwd=self.checkout, text=True).strip()

    @property
    def journal(self):
        emitter = mock.Mock()
        emitter.emit.side_effect = lambda event, **fields: self.events.append((event, fields))
        return emitter

    def push_upstream_commit(self, name):
        """Advance origin/main out from under the checkout, as a merged PR does."""
        self.commit(name)
        self.git("push", "origin", "main")
        self.git("reset", "--hard", "HEAD~1")

    def test_fast_forwards_when_the_checkout_is_merely_behind(self):
        self.push_upstream_commit("second")
        sync_journal = self.journal
        autonomous.sync_main(sync_journal)
        self.assertEqual(self.head("main"), self.head("origin/main"))
        self.assertEqual(self.events, [])

    def test_resets_a_diverged_checkout_instead_of_failing_every_tick(self):
        self.push_upstream_commit("upstream")
        self.commit("stray")
        stray = self.head("main")
        autonomous.sync_main(self.journal)
        self.assertEqual(self.head("main"), self.head("origin/main"))
        self.assertEqual(self.events, [("main_reset_to_origin", {"dropped_commits": 1})])
        # The dropped commit is recoverable, not destroyed.
        self.assertIn(stray[:7], subprocess.check_output(
            ["git", "reflog"], cwd=self.checkout, text=True))

    def test_refuses_to_reset_over_uncommitted_work(self):
        self.push_upstream_commit("upstream")
        self.commit("stray")
        (self.checkout / "scratch").write_text("unsaved", encoding="utf-8")
        self.git("add", "scratch")
        with self.assertRaises(RuntimeError):
            autonomous.sync_main(self.journal)
        self.assertEqual((self.checkout / "scratch").read_text(encoding="utf-8"), "unsaved")
        self.assertEqual(self.events, [])


if __name__ == "__main__":
    unittest.main()
