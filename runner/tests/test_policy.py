import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock

from runner import orchestrator, policy as runner_policy

ROOT = pathlib.Path(__file__).resolve().parents[2]


class RunnerPolicyTests(unittest.TestCase):
    def test_github_head_ref_identifies_detached_agent_branch(self):
        git_outputs = ["src/app.js", "", "", "1\t0\tsrc/app.js", "", ""]
        with mock.patch.dict(os.environ, {"GITHUB_HEAD_REF": "agent/frontend/example"}), \
             mock.patch.object(runner_policy, "git", side_effect=git_outputs):
            self.assertEqual(runner_policy.validate("origin/main"), [])

    def test_production_controls_are_forbidden_to_agents(self):
        policy = json.loads((ROOT / ".agent-policy.json").read_text())
        self.assertIn(".github/workflows/", policy["forbidden_paths"])
        self.assertIn("gh pr merge", policy["forbidden_commands"])
        # Cloudflare operations are owner-enabled: wrangler.toml is editable in a
        # reviewed PR and the wrangler commands are no longer listed. The controls
        # that still bound delivery are the workflow files, the merge command, and
        # branch protection -- not the absence of a CLI.
        self.assertNotIn("wrangler.toml", policy["forbidden_paths"])
        self.assertFalse([c for c in policy["forbidden_commands"] if c.startswith("wrangler ")])

    def test_local_database_capability_is_narrow_and_brokered(self):
        policy = json.loads((ROOT / ".agent-policy.json").read_text())
        databases = policy["local_databases"]
        self.assertTrue(databases["enabled"])
        self.assertEqual(databases["name_prefix"], "wawalu-agent-lab-")
        self.assertEqual(databases["directory"], ".agent/local-databases")
        self.assertFalse(databases["destructive_sql_allowed"])
        self.assertFalse(databases["symlinks_allowed"])
        self.assertIn("runner/local_database.py", policy["forbidden_paths"])
        self.assertIn("sqlite3", policy["forbidden_commands"])
        # `wrangler d1` is owner-enabled; the brokered local-database capability
        # above remains the supported path for ordinary development work.

    def test_worker_merge_capability_is_branch_bound(self):
        source = (ROOT / "runner/orchestrator.py").read_text()
        self.assertIn("consume_merge_request(worktree, persona, branch)", source)
        self.assertIn('"requested_by":"{persona}"', source)

    def test_personas_cannot_rewrite_behavior_probabilities(self):
        policy = json.loads((ROOT / ".agent-policy.json").read_text())
        self.assertIn("config/team-behaviors.json", policy["forbidden_paths"])
        self.assertIn("runner/simulation.py", policy["forbidden_paths"])
        orchestrator = (ROOT / "runner/orchestrator.py").read_text()
        self.assertIn('worker_prompt = f\'\'\'{persona_prompt}', orchestrator)

    def test_personas_use_separate_prompts(self):
        cfg = json.loads((ROOT / "config/personas.example.json").read_text())
        prompts = [v["prompt_file"] for v in cfg["personas"].values()]
        self.assertEqual(len(prompts), len(set(prompts)))
        for prompt in prompts: self.assertTrue((ROOT / prompt).exists())

    def test_orchestrator_uses_dedicated_reviewer_identity(self):
        source = (ROOT / "runner/orchestrator.py").read_text()
        self.assertIn('personas["reviewer"]["prompt_file"]', source)
        self.assertIn("reviewer_token()", source)

    def test_collaborator_capacity_exhaustion_does_not_discard_primary_work(self):
        metadata = {}
        self.assertTrue(orchestrator.record_collaborator_exit(metadata, 75))
        self.assertEqual(metadata, {"collaborator_exit_code": 75, "collaborator_capacity_deferred": True})
        ordinary = {}
        self.assertFalse(orchestrator.record_collaborator_exit(ordinary, 1))
        self.assertEqual(ordinary, {"collaborator_exit_code": 1})
        with mock.patch.object(orchestrator, "CAPACITY_EXIT_CODES", {}):
            self.assertFalse(orchestrator.collaborator_capacity_deferred(75))

    def test_policy_includes_uncommitted_agent_edits(self):
        source = (ROOT / "runner/policy.py").read_text()
        self.assertIn('git("diff", "--name-only")', source)
        self.assertIn('git("diff", "--cached", "--name-only")', source)

    def test_generated_test_output_is_discarded_before_review(self):
        policy = json.loads((ROOT / ".agent-policy.json").read_text())
        self.assertIn("cypress/screenshots/", policy["generated_artifact_paths"])
        with tempfile.TemporaryDirectory() as directory:
            repo = pathlib.Path(directory)
            git = lambda *args: subprocess.run(["git", *args], cwd=repo, check=True,
                                               capture_output=True, text=True)
            git("init", "-q")
            git("config", "user.email", "test@example.com")
            git("config", "user.name", "test")
            (repo / "cypress" / "screenshots").mkdir(parents=True)
            (repo / "cypress" / "screenshots" / "tool tests (failed).png").write_text("baseline")
            (repo / "app.js").write_text("original\n")
            git("add", "--all")
            git("commit", "-qm", "base")
            # what a worker's test run leaves behind, alongside its real change
            (repo / "cypress" / "screenshots" / "tool tests (failed).png").write_text("rerun")
            (repo / "cypress" / "screenshots" / "visual tests (failed).png").write_text("new")
            (repo / "app.js").write_text("edited\n")
            (repo / "styles.css").write_text("added\n")

            discarded = orchestrator.discard_generated_artifacts(repo)

            self.assertEqual(len(discarded), 2)
            self.assertEqual((repo / "cypress" / "screenshots" / "tool tests (failed).png").read_text(),
                             "baseline")
            self.assertFalse((repo / "cypress" / "screenshots" / "visual tests (failed).png").exists())
            self.assertEqual((repo / "app.js").read_text(), "edited\n")
            self.assertTrue((repo / "styles.css").exists())
            self.assertEqual(orchestrator.discard_generated_artifacts(repo), [])

    def test_policy_gate_runs_after_new_files_are_staged(self):
        source = (ROOT / "runner/orchestrator.py").read_text()
        staged = source.index('run(["git", "add", "--intent-to-add", "--all"], cwd=worktree)')
        gate = source.index('run([sys.executable, "-m", "runner.policy"', staged)
        self.assertLess(source.index("discard_generated_artifacts(worktree)", staged - 400), staged)
        self.assertLess(staged, gate)


if __name__ == "__main__":
    unittest.main()
