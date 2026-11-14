import { Button, ButtonLink } from "../../components/ui/button";
import { beginConnection } from "../../server/connections/mutations";
import { database } from "../../server/db/connection";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";
import { secretKey } from "../../server/secret-key";
import { connect } from "./actions";
import { FieldInputs } from "./field-inputs";
import { PlaidLink } from "./plaid-link";

export async function ConnectStep({ adapter, name, connectionId, back }: {
  adapter: ProviderAdapter;
  name: string;
  connectionId?: number;
  back: { href: string; label: string };
}) {
  const backLink = <ButtonLink href={back.href} size="sm">{back.label}</ButtonLink>;
  let begun;
  try {
    begun = await beginConnection(database(), secretKey(), adapter, { connectionId });
  } catch (error) {
    return <div className="grid justify-items-start gap-3">
      <p className="text-sm text-danger" role="alert">{error instanceof Error ? error.message : "Could not start the connection."}</p>
      {backLink}
    </div>;
  }
  const { start, state } = begun;
  if (start.kind === "form") {
    return <form className="grid gap-3" action={connect}>
      <input type="hidden" name="provider" value={adapter.key} />
      <input type="hidden" name="state" value={state} />
      {connectionId && <input type="hidden" name="connection" value={connectionId} />}
      <FieldInputs fields={start.fields} prefix="field-" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm">{connectionId ? "Re-authorize" : "Connect"}</Button>
        {backLink}
      </div>
    </form>;
  }
  if (start.kind === "widget" && start.widget === "plaid-link") {
    return <div className="flex flex-wrap items-center gap-2">
      <PlaidLink providerKey={adapter.key} linkToken={start.params.linkToken} state={state}
        mode={start.params.mode === "update" ? "update" : "create"} />
      {backLink}
    </div>;
  }
  if (start.kind === "redirect") {
    return <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={start.url} variant="primary" size="sm">Continue to {name}</ButtonLink>
      {backLink}
    </div>;
  }
  return <div className="grid justify-items-start gap-3">
    <p className="text-sm text-muted">This provider's sign-in is not available in this version</p>
    {backLink}
  </div>;
}
