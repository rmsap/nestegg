import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { money } from "../../lib/finance";
import { goals } from "../../server/demo";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  return <>
    <PageHeading title="Goals" />
    <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,195px),1fr))] gap-3.5">
      {goals.map(({ name, saved, target }) => <Panel heading={name} key={name}>
        <p>{money(saved)} of {money(target)}</p>
        <progress className="w-full accent-green" aria-label={name} max={target} value={saved} />
        <p className="text-sm text-muted">{money(target - saved)} to go</p>
      </Panel>)}
    </div>
  </>;
}
