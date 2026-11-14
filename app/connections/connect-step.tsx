import { Button, ButtonLink } from "../../components/ui/button";
import { beginConnection } from "../../server/connections/mutations";
import { database } from "../../server/db/connection";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";
import { secretKey } from "../../server/secret-key";
import { connect } from "./actions";
import { FieldInputs } from "./field-inputs";
import { PlaidLink } from "./plaid-link";

export async function ConnectStep({ adapter, name, connectionId, cancelHref }: {
  adapter: ProviderAdapter;
  name: string;
  connectionId?: number;
  cancelHref?: string;
}) {
  let begun;
  try {
    begun = await beginConnection(database(), secretKey(), adapter, { connectionId });
  } catch (error) {
    return <p className="rounded-lg bg-accent px-2.5 py-1.5 text-sm" role="status">{error instanceof Error ? error.message : "Could not start the connection."}</p>;
  }
  const { start, state } = begun;
  const cancel = cancelHref && <ButtonLink href={cancelHref}>Cancel</ButtonLink>;
  if (start.kind === "form") {
    return <form className="grid gap-3" action={connect}>
      <input type="hidden" name="provider" value={adapter.key} />
      <input type="hidden" name="state" value={state} />
      {connectionId && <input type="hidden" name="connection" value={connectionId} />}
      <FieldInputs fields={start.fields} prefix="field-" />
      <div className="flex flex-wrap items-end gap-2.5">
        <Button type="submit" variant="primary">{connectionId ? "Re-authorize" : "Connect"}</Button>
        {cancel}
      </div>
    </form>;
  }
  if (start.kind === "widget" && start.widget === "plaid-link") {
    return <div className="flex flex-wrap items-center gap-2.5">
      <PlaidLink providerKey={adapter.key} linkToken={start.params.linkToken} state={state}
        mode={start.params.mode === "update" ? "update" : "create"} />
      {cancel}
    </div>;
  }
  if (start.kind === "redirect") {
    return <div className="flex flex-wrap items-center gap-2.5">
      <ButtonLink href={start.url} variant="primary">Continue to {name}</ButtonLink>
      {cancel}
    </div>;
  }
  return <p className="text-sm text-muted">This provider's sign-in is not available in this version.</p>;
}
