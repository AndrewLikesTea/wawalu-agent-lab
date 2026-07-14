import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class RunnerPolicyTests(unittest.TestCase):
    def test_production_controls_are_forbidden_to_agents(self):
        policy = json.loads((ROOT / ".agent-policy.json").read_text())
        self.assertIn(".github/workflows/", policy["forbidden_paths"])
        self.assertIn("wrangler.toml", policy["forbidden_paths"])
        self.assertIn("gh pr merge", policy["forbidden_commands"])

    def test_personas_use_separate_prompts(self):
        cfg = json.loads((ROOT / "config/personas.example.json").read_text())
        prompts = [v["prompt_file"] for v in cfg["personas"].values()]
        self.assertEqual(len(prompts), len(set(prompts)))
        for prompt in prompts: self.assertTrue((ROOT / prompt).exists())

    def test_policy_includes_uncommitted_agent_edits(self):
        source = (ROOT / "runner/policy.py").read_text()
        self.assertIn('git("diff", "--name-only")', source)
        self.assertIn('git("diff", "--cached", "--name-only")', source)


if __name__ == "__main__":
    unittest.main()
