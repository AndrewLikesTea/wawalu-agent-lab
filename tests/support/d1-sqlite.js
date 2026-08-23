// A D1-shaped adapter over node:sqlite, for tests only.
//
// The previous social-posts D1 tests asserted on the SQL *strings* a store
// emitted. That proves the store is parameterized; it cannot prove a CHECK
// constraint fires, a unique index serializes two writers, or that a batch
// rolls back. Those are exactly the properties this change depends on, so the
// tests run the real migrations against a real SQLite engine instead.
//
// In-memory only: no database file is created, nothing is read from disk except
// the checked-in migration SQL, and no production or local database is touched.

import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

export const MIGRATIONS = ["0003_social_posts.sql", "0004_social_post_media.sql", "0005_media_objects.sql", "0006_leads.sql", "0007_lead_submissions.sql", "0008_follow_up_request_types.sql", "0009_finops_example_follow_up.sql", "0010_follow_up_topics.sql", "0011_follow_up_message.sql"];

function normalizeArgs(args) {
  // D1 accepts JS nulls/booleans; node:sqlite wants null/number/string/bigint/
  // Uint8Array.
  return args.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

// Statements that hand rows back go through .all(); everything else reports a
// change count, mirroring how D1 shapes its two result kinds.
function returnsRows(sql) {
  return /^\s*(?:SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
}

/**
 * `migrations` defaults to every migration this suite runs. A test passes a
 * shorter prefix to stand a database up at an older schema — the state a live
 * database is in between a merge that adds a migration and an operator running
 * it, which is where "the write was refused" and "the row already existed" stop
 * being the same answer.
 */
export async function createTestD1({ migrations = MIGRATIONS } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const name of migrations) {
    db.exec(await readFile(new URL(`../../migrations/${name}`, import.meta.url), "utf8"));
  }

  function statement(sql, bound) {
    return {
      __sql: sql,
      __bound: bound,
      bind: (...args) => statement(sql, normalizeArgs(args)),
      __execute() {
        const prepared = db.prepare(sql);
        if (returnsRows(sql)) return { results: prepared.all(...bound), success: true, meta: { changes: 0 } };
        const result = prepared.run(...bound);
        return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
      async first(column) {
        const row = this.__execute().results[0] ?? null;
        return column === undefined || row === null ? row : (row[column] ?? null);
      },
      async all() { return this.__execute(); },
      async run() { return this.__execute(); },
    };
  }

  return {
    prepare: (sql) => statement(sql, []),
    // D1 runs a batch as one implicit transaction: a failure rolls the whole
    // batch back. Reproduced here so tests exercise the same semantics the
    // stores rely on.
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((entry) => entry.__execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => db.close(),
    raw: db,
  };
}
