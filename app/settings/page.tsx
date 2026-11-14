import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { ownerPrimaryColor } from "../../server/users/appearance";
import { ThemePicker } from "./theme-picker";

export default function SettingsPage() {
  const color = ownerPrimaryColor();
  return <>
    <PageHeading title="Settings" />
    <Panel heading="Appearance">
      <ThemePicker key={color} initialColor={color} />
    </Panel>
  </>;
}
