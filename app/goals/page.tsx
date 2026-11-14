import { PageHeading } from "../../components/page-heading";
import { money } from "../../lib/finance";
import { goals } from "../../server/demo";

export const dynamic = "force-dynamic";

export default function GoalsPage() {
  const demo = process.env.NESTEGG_DEMO === "1";
  return <>
    <PageHeading title="Goals" />
    {!demo && <section className="panel"><p>No goals yet.</p></section>}
    <div className="account-grid">
      {demo && goals.map(({ name, saved, target }) => <section className="panel" key={name}>
        <h2>{name}</h2>
        <p>{money(saved)} of {money(target)}</p>
        <progress aria-label={name} max={target} value={saved} />
        <p className="muted">{money(target - saved)} to go</p>
      </section>)}
    </div>
  </>;
}
