import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initialize } from "../server/db/migrations.ts";

const directory = process.env.NESTEGG_DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(directory, { recursive: true });
const path = join(directory, "nestegg.sqlite");
const db = new DatabaseSync(path);
try {
  initialize(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const { occupied } = db.prepare(`
      SELECT EXISTS(
        SELECT 1 FROM categories UNION ALL
        SELECT 1 FROM accounts UNION ALL
        SELECT 1 FROM budget_months
      ) AS occupied
    `).get();
    if (occupied) {
      console.log("Demo database already contains data. It was left as is.");
    } else {
      db.exec(`
        INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
          (1, 1, 'Everyday checking', 'bank', 'asset', 485000),
          (2, 1, 'High-yield savings', 'bank', 'asset', 1645000),
          (3, 1, 'Rewards card', 'credit_card', 'liability', 245000),
          (4, 1, 'Manual investment account', 'investment', 'asset', 2400000);
        INSERT INTO categories (id, user_id, name) VALUES
          (1, 1, 'Housing'), (2, 1, 'Groceries'), (3, 1, 'Dining'),
          (4, 1, 'Shopping'), (5, 1, 'Transport'), (6, 1, 'Other essentials');
        INSERT INTO budget_months (user_id, month, expected_income_cents) VALUES (1, '2026-11', 680000);
        INSERT INTO budget_limits (user_id, month, category_id, limit_cents) VALUES
          (1, '2026-11', 1, 200000), (1, '2026-11', 2, 65000), (1, '2026-11', 3, 30000),
          (1, '2026-11', 4, 25000), (1, '2026-11', 5, 30000), (1, '2026-11', 6, 170000);
        INSERT INTO transactions
          (id, date, merchant, account_id, amount_cents, category_id, kind, pending, reviewed) VALUES
          (1,'2026-11-08','Whole Foods Market',3,-8642,2,'expense',0,0),
          (2,'2026-11-08','Neighborhood Coffee',3,-1250,3,'expense',1,0),
          (3,'2026-11-07','Northline Outfitters',3,-7400,4,'expense',0,0),
          (4,'2026-11-05','Monthly rent',1,-185000,1,'expense',0,1),
          (5,'2026-11-04','Credit card payment',1,-95000,NULL,'transfer',0,1),
          (6,'2026-11-01','Payroll',1,340000,NULL,'income',0,1),
          (7,'2026-11-01','Metro transit',3,-3200,5,'expense',0,1),
          (8,'2026-11-06','Market pantry order',3,-39594,2,'expense',0,1),
          (9,'2026-11-06','Weekend meals',3,-23800,3,'expense',0,1),
          (10,'2026-11-05','Home goods',3,-21100,4,'expense',0,1),
          (11,'2026-11-04','Transit pass',1,-15000,5,'expense',0,1),
          (12,'2026-11-03','Utilities and insurance',1,-50000,6,'expense',0,1);
      `);
    }
    db.exec("COMMIT");
    if (!occupied) console.log("Seeded " + path);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
} finally {
  db.close();
}
