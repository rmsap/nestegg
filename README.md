# Nestegg

Nestegg is a local budgeting prototype built with Next.js App Router, TypeScript, and SQLite. New databases start empty. The overview and budgets use the selected reporting month. Categories, monthly limits, accounts, and transaction reviews are saved in `data/nestegg.sqlite`.

## Run locally

Use Node.js 22.14 or later and npm. From the project directory on Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The development and start scripts bind to loopback. Use fictional data during this phase. Application authentication is planned before deployment or ingestion of real financial data.

Open **Budget** to add a category. **Edit categories** opens the limits and shows an × beside each name. Deleting a category with transactions requires a destination category. **Transactions** supports search, category filters, and review.

Set `NESTEGG_DATA_DIR` to use a different database directory. Existing prototype databases upgrade automatically. The upgrade preserves transactions and category IDs, moves the existing limits to November 2026, and creates accounts from the transaction labels. Existing labels have no stored balances, so those accounts display “Balance unavailable.”

To use the separate demo database with fictional November 2026 accounts and transactions:

```powershell
npm.cmd run seed:demo
$env:NESTEGG_DEMO = '1'
npm.cmd run dev
```

Use a fresh shell or remove `Env:NESTEGG_DEMO` to return to the normal database. If set, `NESTEGG_DATA_DIR` overrides the database location. The seed command always targets `data/demo/nestegg.sqlite` and leaves existing data in that database intact.

```powershell
npm.cmd run typecheck
npm.cmd run build
```

## Code layout

- `app/` contains the App Router pages and shared layout. Budget and Transactions each own their form actions. The overview lives at `/`.
- `components/` contains shared presentation such as navigation, metrics, and the activity list.
- `server/budget/` and `server/transactions/` contain SQLite queries and writes for each feature. The form actions parse input and delegate to these modules.
- `server/db/` handles the SQLite connection and numbered migrations. `server/accounts/` reads persisted accounts. `scripts/seed-demo.mjs` loads sample rows separately, and `server/demo.ts` holds the sample goals.

## Teller and deployment

- Each project partner runs one independent instance on their own tailnet, with a separate database, owner sign-in, bank connections, secrets, and backups.
- The manual sandbox importer implements the documented Teller API. Sandbox availability is unverified following reports that Teller withdrew its API in July 2026. Before connecting a real bank, add owner authentication, encrypted enrollment tokens, and certificate configuration for the selected provider.
- Ubuntu Server on a mini PC is the preferred first deployment target. Check the host architecture and build the matching image. Use `linux/amd64` for an x86-64 mini PC and `linux/arm64` for a 64-bit ARM host. Each host can serve its own HTTPS address through Tailscale Serve.

This prototype uses Node's built-in SQLite driver and USD integer cents. The project plan covers the remaining work, including account sync, history, goal allocations, CSV workflows, authentication, PWA installation, Docker, and Tailscale.

### Transaction providers

`server/imports/transaction-provider.ts` defines the normalized accounts and transactions an adapter returns. `server/imports/sync.ts` fetches and imports one batch atomically. A new provider implements the same interface and can use the importer directly. Account identity is scoped to the provider and transaction identity to the imported account. A provider switch leaves both sets of records available under their own identities, so overlapping history needs explicit reconciliation.

If you already have a Teller Sandbox enrollment token, place it in the ignored `.env.local` file as `TELLER_SANDBOX_TOKEN`. An Application ID is used for enrollment and cannot run the importer on its own. Run the following from the project directory:

```powershell
npm.cmd run sync:teller-sandbox
$env:NESTEGG_DATA_DIR = 'data/teller-sandbox'
npm.cmd run dev
```

Choose the reporting month containing the imported transactions. The importer targets its own SQLite file and accepts only sandbox tokens and USD accounts. Posted expenses appear in Uncategorized until assigned. A pending transaction that posts under the same provider ID updates in place. If the provider assigns a different ID on posting, the posted item counts once and the old pending item can still appear in the ledger.

- [Project plan](docs/PROJECT_PLAN.md)
- [Original interface mock](docs/UI_MOCKS.html)
