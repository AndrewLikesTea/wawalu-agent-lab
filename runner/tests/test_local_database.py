import contextlib
import pathlib
import sqlite3
import tempfile
import unittest

from runner.local_database import LocalDatabaseManager, LocalDatabasePolicyError


def database_policy():
    return {
        "enabled": True,
        "directory": ".agent/local-databases",
        "name_prefix": "wawalu-agent-lab-",
        "max_name_length": 64,
        "migration_directory": "migrations",
        "allowed_operations": ["create", "migrate", "check", "path"],
        "destructive_sql_allowed": False,
        "symlinks_allowed": False,
    }


class LocalDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        (self.root / "migrations").mkdir()
        self.manager = LocalDatabaseManager(self.root, database_policy())

    def tearDown(self):
        self.temp.cleanup()

    def test_creates_only_prefixed_database_in_scoped_directory(self):
        path = self.manager.create("wawalu-agent-lab-social")
        self.assertEqual(path.parent.resolve(), (self.root / ".agent/local-databases").resolve())
        self.assertTrue(path.is_file())
        self.assertEqual(self.manager.check("wawalu-agent-lab-social"), "ok")

        for name in ("social", "wawalu-agent-lab-../escape", "wawalu-agent-lab-UPPER"):
            with self.subTest(name=name), self.assertRaises(LocalDatabasePolicyError):
                self.manager.create(name)

    def test_applies_migrations_once_and_detects_changed_history(self):
        migration = self.root / "migrations/0001_posts.sql"
        migration.write_text("CREATE TABLE posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);", encoding="utf-8")
        self.assertEqual(self.manager.migrate("wawalu-agent-lab-social"), ["0001_posts.sql"])
        self.assertEqual(self.manager.migrate("wawalu-agent-lab-social"), [])

        path = self.manager.database_path("wawalu-agent-lab-social")
        with contextlib.closing(sqlite3.connect(path)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE name='posts'").fetchone(), ("posts",))

        migration.write_text("CREATE TABLE posts_changed (id TEXT);", encoding="utf-8")
        with self.assertRaisesRegex(LocalDatabasePolicyError, "applied migration changed"):
            self.manager.migrate("wawalu-agent-lab-social")

    def test_rejects_destructive_sql_and_symlink_escape(self):
        (self.root / "migrations/0001_drop.sql").write_text("DROP TABLE posts;", encoding="utf-8")
        with self.assertRaisesRegex(LocalDatabasePolicyError, "destructive SQL"):
            self.manager.migrate("wawalu-agent-lab-social")

        external = self.root / "external"
        external.mkdir()
        symlink_policy = database_policy()
        symlink_policy["directory"] = ".agent/symlink-databases"
        symlink_manager = LocalDatabaseManager(self.root, symlink_policy)
        database_dir = self.root / ".agent/symlink-databases"
        database_dir.parent.mkdir(parents=True, exist_ok=True)
        database_dir.symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(LocalDatabasePolicyError, "symlink"):
            symlink_manager.create("wawalu-agent-lab-other")

    def test_disallowed_operation_is_rejected(self):
        with self.assertRaisesRegex(LocalDatabasePolicyError, "not allowed"):
            self.manager.validate_operation("delete")


if __name__ == "__main__":
    unittest.main()
