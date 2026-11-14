import type { DatabaseSync } from "node:sqlite";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0)
      ) STRICT;
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        merchant TEXT NOT NULL,
        account TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
        pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0,1)),
        reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0,1)),
        CHECK ((kind = 'expense') = (category_id IS NOT NULL))
      ) STRICT;
      CREATE INDEX transaction_category_date ON transactions(category_id, date);
      CREATE INDEX transaction_date ON transactions(date);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('bank', 'credit_card', 'investment', 'other')),
        balance_cents INTEGER
      ) STRICT;
      INSERT INTO accounts (name, kind)
        SELECT DISTINCT account, 'other' FROM transactions ORDER BY account;

      CREATE TABLE budget_months (
        month TEXT PRIMARY KEY,
        expected_income_cents INTEGER NOT NULL DEFAULT 0 CHECK (expected_income_cents >= 0)
      ) STRICT;
      CREATE TABLE budget_limits (
        month TEXT NOT NULL REFERENCES budget_months(month) ON DELETE CASCADE,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0),
        PRIMARY KEY (month, category_id)
      ) STRICT;
      CREATE INDEX budget_limits_category ON budget_limits(category_id);
      -- The previous interface displayed all limits under November 2026.
      INSERT INTO budget_months (month, expected_income_cents)
        SELECT '2026-11', 680000 WHERE EXISTS (SELECT 1 FROM categories);
      INSERT INTO budget_limits
        SELECT '2026-11', id, limit_cents FROM categories;

      CREATE TABLE transactions_v2 (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        merchant TEXT NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        amount_cents INTEGER NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
        pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0,1)),
        reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0,1)),
        CHECK ((kind = 'expense') = (category_id IS NOT NULL))
      ) STRICT;
      INSERT INTO transactions_v2
        SELECT t.id, t.date, t.merchant, a.id, t.amount_cents, t.category_id,
          t.kind, t.pending, t.reviewed
        FROM transactions t JOIN accounts a ON a.name = t.account;
      DROP TABLE transactions;
      ALTER TABLE transactions_v2 RENAME TO transactions;
      CREATE INDEX transaction_category_date ON transactions(category_id, date);
      CREATE INDEX transaction_date ON transactions(date);
      CREATE INDEX transaction_account_date ON transactions(account_id, date);
      ALTER TABLE categories DROP COLUMN limit_cents;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE accounts ADD COLUMN provider TEXT;
      ALTER TABLE accounts ADD COLUMN external_id TEXT;
      CREATE UNIQUE INDEX accounts_provider_identity ON accounts(provider, external_id);

      CREATE TABLE transactions_v3 (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        merchant TEXT NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        amount_cents INTEGER NOT NULL,
        category_id INTEGER REFERENCES categories(id),
        kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
        pending INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0,1)),
        reviewed INTEGER NOT NULL DEFAULT 0 CHECK (reviewed IN (0,1)),
        external_id TEXT,
        UNIQUE (account_id, external_id)
      ) STRICT;
      INSERT INTO transactions_v3
        (id, date, merchant, account_id, amount_cents, category_id, kind, pending, reviewed)
        SELECT id, date, merchant, account_id, amount_cents, category_id, kind, pending, reviewed
        FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_v3 RENAME TO transactions;
      CREATE INDEX transaction_category_date ON transactions(category_id, date);
      CREATE INDEX transaction_date ON transactions(date);
    `,
  },
  {
    version: 4,
    sql: "ALTER TABLE transactions ADD COLUMN memo TEXT",
  },
  {
    version: 5,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        primary_color TEXT CHECK (
          length(primary_color) = 7 AND substr(primary_color, 1, 1) = '#'
          AND substr(primary_color, 2) NOT GLOB '*[^0-9a-f]*'
        )
      ) STRICT;
      INSERT INTO users (id) VALUES (1);
    `,
  },
];

export function initialize(db: DatabaseSync) {
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
  try {
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    if (!Number.isInteger(version) || version > migrations.length || version < 0) {
      throw new Error("Unsupported Nestegg database schema");
    }
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      db.exec(migration.sql);
      db.exec("PRAGMA user_version = " + migration.version);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
