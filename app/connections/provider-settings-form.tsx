import { Button, ButtonLink } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Switch } from "../../components/ui/switch";
import { database } from "../../server/db/connection";
import { describeProviderSettings } from "../../server/imports/provider-settings";
import { secretKey } from "../../server/secret-key";
import { saveProvider } from "./actions";
import type { Entry } from "./add-panel";
import { FieldInputs } from "./field-inputs";

export function ProviderSettingsForm({ adapter, provider, then }: Entry & { then: boolean }) {
  return <form className="grid gap-3" action={saveProvider}>
    <input type="hidden" name="provider" value={adapter.key} />
    {then && <input type="hidden" name="then" value="add" />}
    <FieldInputs fields={describeProviderSettings(database(), secretKey(), adapter)} prefix="setting-" />
    <Field label="Sync every (minutes)">
      <input name="interval" type="number" min={provider.min_sync_interval_minutes} max="10080" step="1"
        defaultValue={provider.sync_interval_minutes} required />
    </Field>
    <Switch name="enabled" label="Provider on" defaultChecked={then || Boolean(provider.enabled)} />
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="primary" size="sm">Save settings</Button>
      <ButtonLink href={then ? "/connections?add=1" : "/connections"} size="sm">Cancel</ButtonLink>
    </div>
  </form>;
}
