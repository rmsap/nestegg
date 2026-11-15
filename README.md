# Nestegg

Nestegg is a local budgeting prototype built with Next.js App Router, TypeScript, and SQLite. The seed loads sample accounts and activity for November 2026, the default reporting month. Categories, monthly limits, accounts, and transaction reviews are saved in `data/nestegg.sqlite`.

## Run locally

Use Node.js 22.14 or later and npm. From the project directory on Windows PowerShell:

```powershell
npm.cmd install
npm.cmd run seed:demo
npm.cmd run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The development and start scripts bind to loopback. Use fictional data during this phase. Application authentication is planned before deployment or ingestion of real financial data.

Open **Budget** to add a category. **Edit categories** opens the limits and shows an × beside each name. Deleting a category with transactions requires a destination category. **Transactions** supports search, category filters, and review.

The app and seed command use the same database. The seed leaves existing records intact. Set `NESTEGG_DATA_DIR` only when you want to point the app or seed command at a different directory.

```powershell
npm.cmd run typecheck
npm.cmd run build
```

## Tests

Run the unit and SQLite integration suite with `npm test`. Tests live alongside the code they exercise in `lib/`, `server/`, and `scripts/`. The browser specs live in `tests/e2e/`.

To run the browser suite locally:

```powershell
npx.cmd playwright install chromium
npm.cmd run build
npm.cmd run test:e2e
```

Playwright starts the production build on port 3100 with a fresh demo database in a temporary directory. Provider tests use fixtures and mocked HTTP, and the browser suite uses Demo Bank. The Tests workflow runs both suites on pull requests.

## Linting and formatting

- `npm.cmd run lint` checks the whole app with ESLint. GitHub Actions checks changed files on pull requests. Warnings and errors fail either check.
- `npm.cmd run format` formats the code with Prettier. Use `npm.cmd run format:check` to check formatting without writing files.

## Code layout

- `app/` contains the App Router pages and shared layout. Budget and Transactions each own their form actions. The overview lives at `/`.
- `components/` contains shared presentation such as navigation, metrics, and the activity list.
- `server/budget/` and `server/transactions/` contain SQLite queries and writes for each feature. The form actions parse input and delegate to these modules.
- `server/db/` handles the SQLite connection and numbered migrations. `server/accounts/` reads persisted accounts. `scripts/seed-demo.mjs` loads sample rows separately, and `server/demo.ts` holds the sample goals.

## Deployment

- Each project partner runs one independent instance on their own tailnet, with a separate database, owner sign-in, bank connections, secrets, and backups.
- Before connecting a real bank, add owner authentication and certificate configuration for the selected provider.
- Ubuntu Server on a mini PC is the preferred first deployment target. Check the host architecture and build the matching image. Use `linux/amd64` for an x86-64 mini PC and `linux/arm64` for a 64-bit ARM host. Each host can serve its own HTTPS address through Tailscale Serve.

This prototype uses Node's built-in SQLite driver and USD integer cents. The project plan covers the remaining work, including account sync, history, goal allocations, CSV workflows, authentication, PWA installation, Docker, and Tailscale.

### Transaction providers

`server/imports/transaction-provider.ts` defines the adapter contract and the normalized accounts and transactions an adapter returns, and `server/imports/providers.ts` registers adapters by provider key. An adapter has four operations: begin and complete a connection, fetch accounts for a date window, and optionally disconnect. Each provider's settings are stored encrypted. `server/imports/sync.ts` syncs one connection: it fetches a date window with the decrypted credential and settings, then imports the batch atomically. A built-in demo provider generates deterministic accounts and transactions, including pending rows and failure scenarios, so the whole flow works without a bank. A new provider implements the adapter contract, passes `server/imports/adapter-contract.mjs`, and registers itself. Account identity is scoped to the connection and transaction identity to the imported account. A connection switch leaves both sets of records available under their own identities, so overlapping history needs explicit reconciliation.

Enabled connections sync automatically on each provider's interval while the server is running. Set `NESTEGG_SCHEDULER=0` to turn the scheduler off. `npm run sync` syncs every enabled connection once from the command line, or one connection when given its ID.

Posted expenses appear in Uncategorized until assigned. A pending transaction that posts under the same provider ID updates in place. If the provider assigns a different ID on posting, the posted item counts once. The old pending item disappears from the ledger once a later sync no longer returns it.

Stored credentials are encrypted with a key from `NESTEGG_SECRET_KEY` (base64 of 32 bytes) or, when that is unset, from `data/secret.key`, which is created on first use. Back the key up together with the database. Without it the stored credentials cannot be decrypted.

- [Project plan](docs/PROJECT_PLAN.md)
- [Original interface mock](docs/UI_MOCKS.html)
