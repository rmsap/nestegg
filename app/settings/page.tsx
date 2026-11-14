import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { ownerAppearance } from "../../server/users/appearance";
import { ThemePicker } from "./theme-picker";

export default function SettingsPage() {
  const { color, mode } = ownerAppearance();
  return <>
    <PageHeading title="Settings" />
    <Panel heading="Appearance">
      <ThemePicker key={color + mode} initialColor={color} initialMode={mode} />
    </Panel>
  </>;
}
