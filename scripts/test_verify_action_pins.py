import unittest
from verify_action_pins import validate_workflow, ACTIONS


class ActionPinPolicyTest(unittest.TestCase):
    def test_checked_commit_and_local_action_are_allowed(self):
        good = "- uses: actions/checkout@" + ACTIONS["actions/checkout"]
        self.assertEqual(validate_workflow(good + "\n - uses: ./local-action"), [])

    def test_floating_unknown_and_unapproved_refs_fail(self):
        sources = ["- uses: actions/checkout@v4",
                   "- uses: attacker/unknown@" + "a" * 40,
                   "uses: actions/setup-node@" + "a" * 40,
                   "uses: actions/upload-artifact"]
        for source in sources:
            with self.subTest(source=source):
                self.assertTrue(validate_workflow(source))


if __name__ == "__main__":
    unittest.main()
