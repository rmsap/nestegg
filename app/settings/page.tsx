import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";
import { userPrimaryColor } from "../../server/users/users";
import { ThemePicker } from "./theme-picker";

export default async function SettingsPage() {
  const user = await currentUser();
  const color = userPrimaryColor(database(), user.id);
  return <>
    <PageHeading title="Settings" />
    <Panel heading="Appearance">
      <ThemePicker key={color} initialColor={color} />
    </Panel>
  </>;
}
