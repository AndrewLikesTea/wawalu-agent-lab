import unittest

from runner.simulation import choose_collaborator, choose_distraction, happens, load_behaviors, personality_context


class SimulationTests(unittest.TestCase):
    def test_personality_traits_are_stable_and_distinct(self):
        behaviors = load_behaviors()
        profiles = behaviors["personas"]
        self.assertGreater(profiles["backend"]["error_proneness"], profiles["infrastructure"]["error_proneness"])
        self.assertGreater(profiles["frontend"]["distraction_rate"], profiles["backend"]["distraction_rate"])
        self.assertEqual(happens(0.5, "same", "seed"), happens(0.5, "same", "seed"))

    def test_collaboration_and_distraction_selection_are_deterministic(self):
        behaviors = load_behaviors()
        one = choose_collaborator("staff", "scenario", ["staff", "backend", "frontend"], behaviors)
        two = choose_collaborator("staff", "scenario", ["staff", "backend", "frontend"], behaviors)
        self.assertEqual(one, two)
        self.assertEqual(choose_distraction("frontend", "scenario", behaviors),
                         choose_distraction("frontend", "scenario", behaviors))

    def test_blind_spot_never_instructs_deliberate_breakage(self):
        profile = load_behaviors()["personas"]["backend"]
        context = personality_context(profile, True)
        self.assertIn("Do not deliberately introduce defects", context)
        self.assertIn(profile["blind_spot"], context)


if __name__ == "__main__":
    unittest.main()
