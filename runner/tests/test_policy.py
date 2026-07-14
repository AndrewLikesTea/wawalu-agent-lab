import json
import os
import pathlib
import unittest
from unittest import mock

from runner import policy as runner_policy

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
        self.assertIn("wrangler.toml", policy["forbidden_paths"])
        self.assertIn("gh pr merge", policy["forbidden_commands"])

    def test_worker_merge_capability_is_branch_bound(self):
        source = (ROOT / "runner/orchestrator.py").read_text()
        self.assertIn("consume_merge_request(worktree, persona, branch)", source)
        self.assertIn('"requested_by":"{persona}"', source)

    def test_personas_use_separate_prompts(self):
        cfg = json.loads((ROOT / "config/personas.example.json").read_text())
        prompts = [v["prompt_file"] for v in cfg["personas"].values()]
        self.assertEqual(len(prompts), len(set(prompts)))
        for prompt in prompts: self.assertTrue((ROOT / prompt).exists())

    def test_orchestrator_uses_dedicated_reviewer_identity(self):
        source = (ROOT / "runner/orchestrator.py").read_text()
        self.assertIn('personas["reviewer"]["prompt_file"]', source)
        self.assertIn("reviewer_token()", source)

    def test_policy_includes_uncommitted_agent_edits(self):
        source = (ROOT / "runner/policy.py").read_text()
        self.assertIn('git("diff", "--name-only")', source)
        self.assertIn('git("diff", "--cached", "--name-only")', source)


if __name__ == "__main__":
    unittest.main()
