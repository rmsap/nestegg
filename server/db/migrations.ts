import type { DatabaseSync } from "node:sqlite";

export const migrations = [
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
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        currency TEXT NOT NULL DEFAULT 'USD',
        password_hash TEXT,
        session_version INTEGER NOT NULL DEFAULT 1,
        setup_completed_at TEXT
      ) STRICT;
      INSERT INTO settings (id) VALUES (1);

      CREATE TABLE providers (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        sync_interval_minutes INTEGER NOT NULL,
        min_sync_interval_minutes INTEGER NOT NULL,
        lookback_days INTEGER NOT NULL,
        CHECK (sync_interval_minutes >= min_sync_interval_minutes AND min_sync_interval_minutes > 0 AND lookback_days > 0)
      ) STRICT;
      INSERT INTO providers (key, name, enabled, sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
        ('simplefin', 'SimpleFIN Bridge', 1, 720, 60, 30);

      CREATE TABLE connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL REFERENCES providers(key),
        label TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'needs_reauth', 'error')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
        credential_encrypted TEXT,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      ) STRICT;

      CREATE TABLE jobs (
        key TEXT PRIMARY KEY,
        schedule TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        next_run_at TEXT,
        last_run_at TEXT,
        locked_until TEXT
      ) STRICT;
      INSERT INTO jobs (key, schedule) VALUES ('sync-connections', '*/5 * * * *');

      CREATE TABLE job_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT NOT NULL REFERENCES jobs(key) ON DELETE CASCADE,
        trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
        error TEXT
      ) STRICT;
      CREATE INDEX job_run_job_started ON job_runs(job_key, started_at);

      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        job_run_id INTEGER REFERENCES job_runs(id) ON DELETE SET NULL,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        finished_at TEXT,
        status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
        window_start TEXT,
        window_end TEXT,
        accounts_seen INTEGER NOT NULL DEFAULT 0,
        transactions_added INTEGER NOT NULL DEFAULT 0,
        transactions_updated INTEGER NOT NULL DEFAULT 0,
        transactions_removed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      ) STRICT;
      CREATE INDEX sync_run_connection_started ON sync_runs(connection_id, started_at);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'notice', 'warning', 'error')),
        type TEXT NOT NULL,
        actor TEXT NOT NULL CHECK (actor IN ('owner', 'scheduler', 'system')),
        connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
        sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
        job_run_id INTEGER REFERENCES job_runs(id) ON DELETE SET NULL,
        message TEXT NOT NULL,
        detail TEXT
      ) STRICT;
      CREATE INDEX event_at ON events(at);
      CREATE INDEX event_type_at ON events(type, at);

      CREATE TABLE notification_targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('smtp', 'webhook')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        config TEXT NOT NULL,
        secret_encrypted TEXT
      ) STRICT;
      CREATE TABLE notification_matchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
        match_severity TEXT NOT NULL,
        match_types TEXT NOT NULL DEFAULT '[]'
      ) STRICT;
      INSERT INTO notification_matchers (name, enabled, match_severity, match_types)
        VALUES ('default', 1, '["warning","error"]', '[]');
      CREATE TABLE notification_matcher_targets (
        matcher_id INTEGER NOT NULL REFERENCES notification_matchers(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES notification_targets(id) ON DELETE CASCADE,
        PRIMARY KEY (matcher_id, target_id)
      ) STRICT;
      CREATE TABLE notification_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        target_id INTEGER NOT NULL REFERENCES notification_targets(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT,
        error TEXT
      ) STRICT;
      CREATE INDEX notification_delivery_status ON notification_deliveries(status);

      INSERT INTO connections (provider, label, enabled, status)
        SELECT key, label, 0, 'needs_reauth' FROM (
          SELECT DISTINCT provider AS label,
            substr(provider, 1, instr(provider || ':', ':') - 1) AS key
          FROM accounts WHERE provider IS NOT NULL
        ) WHERE key IN (SELECT key FROM providers) ORDER BY label;

      CREATE TABLE accounts_v5 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('bank', 'credit_card', 'investment', 'loan', 'other')),
        class TEXT NOT NULL CHECK (class IN ('asset', 'liability')),
        currency TEXT NOT NULL DEFAULT 'USD',
        balance_cents INTEGER,
        balance_as_of TEXT,
        connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
        external_id TEXT,
        institution TEXT,
        last_four TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (connection_id, external_id)
      ) STRICT;
      INSERT INTO accounts_v5 (id, name, kind, class, balance_cents, connection_id, external_id)
        SELECT a.id, a.name, a.kind, CASE WHEN a.kind = 'credit_card' THEN 'liability' ELSE 'asset' END,
          a.balance_cents, (SELECT c.id FROM connections c WHERE c.label = a.provider), a.external_id
        FROM accounts a;
      UPDATE sqlite_sequence SET seq = max(seq, COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'accounts'), 0))
        WHERE name = 'accounts_v5';
      DROP TABLE accounts;
      ALTER TABLE accounts_v5 RENAME TO accounts;

      CREATE TABLE balance_snapshots (
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        balance_cents INTEGER NOT NULL,
        PRIMARY KEY (account_id, date)
      ) STRICT;

      CREATE TABLE transactions_v5 (
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
        memo TEXT,
        removed_at TEXT,
        first_seen_sync_run_id INTEGER REFERENCES sync_runs(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (account_id, external_id)
      ) STRICT;
      INSERT INTO transactions_v5
        (id, date, merchant, account_id, amount_cents, category_id, kind, pending, reviewed, external_id, memo)
        SELECT id, date, merchant, account_id, amount_cents, category_id, kind, pending, reviewed, external_id, memo
        FROM transactions;
      DROP TABLE transactions;
      ALTER TABLE transactions_v5 RENAME TO transactions;
      CREATE INDEX transaction_category_date ON transactions(category_id, date);
      CREATE INDEX transaction_date ON transactions(date);
      CREATE INDEX transaction_account_date ON transactions(account_id, date);
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE providers ADD COLUMN settings_encrypted TEXT;
      ALTER TABLE transactions ADD COLUMN counterparty TEXT;
      ALTER TABLE transactions ADD COLUMN provider_category TEXT;
      INSERT INTO providers (key, name, enabled, sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
        ('demo', 'Demo Bank', 1, 60, 1, 10);
    `,
  },
];

export function initialize(db: DatabaseSync) {
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
      if (!Number.isInteger(version) || version > migrations.length || version < 0) {
        throw new Error("Unsupported Nestegg database schema");
      }
      let migrated = false;
      for (const migration of migrations) {
        if (migration.version <= version) continue;
        db.exec(migration.sql);
        db.exec("PRAGMA user_version = " + migration.version);
        migrated = true;
      }
      if (migrated && db.prepare("PRAGMA foreign_key_check").all().length) {
        throw new Error("Migration left foreign key violations");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}
