import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { money } from "../../lib/finance";
import { goals } from "../../server/demo";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  return <>
    <PageHeading title="Goals" />
    <div className="account-grid">
      {goals.map(({ name, saved, target }) => <Panel heading={name} key={name}>
        <p>{money(saved)} of {money(target)}</p>
        <progress aria-label={name} max={target} value={saved} />
        <p className="muted">{money(target - saved)} to go</p>
      </Panel>)}
    </div>
  </>;
}
