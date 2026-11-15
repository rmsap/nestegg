import { Plus } from "lucide-react";
import { PageHeading } from "../../components/page-heading";
import { ButtonLink } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Modal } from "../../components/ui/modal";
import { Panel } from "../../components/ui/panel";
import { readId } from "../../lib/forms";
import { database } from "../../server/db/connection";
import { fundingAccounts, listGoals } from "../../server/goals/goals";
import { currentUser } from "../../server/session";
import { createGoal } from "./actions";
import { AccountReservations, CashBufferDialog, CloseGoalDialog, EditGoalDialog, FundingAccountField, FundingNotice, GoalCard, GoalDialog, GoalTypeField, ReleaseFundsDialog } from "./goal-funding";

export const dynamic = "force-dynamic";

export default async function GoalsPage({ searchParams }: {
  searchParams: Promise<{ add?: string; edit?: string; goal?: string; buffer?: string; notice?: string | string[] }>;
}) {
  const { add, edit, goal, buffer, notice: message } = await searchParams;
  const notice = typeof message === "string" ? message : undefined;
  const user = await currentUser();
  const db = database();
  const goals = listGoals(db, user.id);
  const accounts = fundingAccounts(db, user.id);
  const hasBankAccounts = accounts.some(({ eligible }) => eligible);
  const selectedGoal = goals.find(({ id }) => id === readId(goal ?? null));
  const bufferAccount = accounts.find(({ id, eligible }) => eligible && id === readId(buffer ?? null));
  let fundingDialog = null;
  if (add === "1") {
    fundingDialog = hasBankAccounts
      ? <GoalDialog title="New savings goal" action={createGoal} submit="Create goal" notice={notice}>
        <Field label="Goal name"><input name="name" maxLength={60} required /></Field>
        <Field label="Target amount">
          <input name="target" type="number" min="0.01" max="1000000" step="0.01" required />
        </Field>
        <FundingAccountField accounts={accounts} />
        <GoalTypeField />
      </GoalDialog>
      : <Modal title="New savings goal" closeHref="/goals">
        <div className="grid justify-items-start gap-3">
          <p>Connect a bank account to fund your goal.</p>
          <ButtonLink href="/connections" variant="primary">Go to Connections</ButtonLink>
        </div>
      </Modal>;
  } else if (selectedGoal && edit === "settings") {
    fundingDialog = <EditGoalDialog goal={selectedGoal} accounts={accounts} notice={notice} />;
  } else if (selectedGoal && edit === "release") {
    fundingDialog = <ReleaseFundsDialog goal={selectedGoal} account={accounts.find(({ id }) => id === selectedGoal.account_id)} notice={notice} />;
  } else if (selectedGoal && edit === "close") {
    fundingDialog = <CloseGoalDialog goal={selectedGoal} notice={notice} />;
  } else if (bufferAccount) {
    fundingDialog = <CashBufferDialog account={bufferAccount} notice={notice} />;
  }

  return <>
    <PageHeading title="Goals" action={
      <ButtonLink href="/goals?add=1" variant="primary" size="sm" className="size-11 justify-center" aria-label="New goal" title="New goal">
        <Plus size={20} aria-hidden="true" />
      </ButtonLink>
    } />
    {!fundingDialog && <FundingNotice notice={notice} />}
    {accounts.length > 0 && <Panel heading="Bank account funding" className="mb-4">
      <p className="mb-2 text-sm text-muted">Available funds are split evenly among the unfinished goals on each account.</p>
      {accounts.map((account) => <AccountReservations key={account.id} account={account} />)}
    </Panel>}
    {goals.length === 0 ? <Panel><p className="text-sm text-muted">No savings goals yet.</p></Panel>
    : <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,195px),1fr))] gap-3.5">
      {goals.map((item) => <GoalCard key={item.id} goal={item} account={accounts.find(({ id }) => id === item.account_id)} />)}
    </div>}
    {fundingDialog}
  </>;
}
