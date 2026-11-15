import type { ReactNode } from "react";
import { Button, ButtonLink } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Modal } from "../../components/ui/modal";
import { Panel } from "../../components/ui/panel";
import { money } from "../../lib/finance";
import { releasableFunds, type FundingAccount, type Goal } from "../../server/goals/goals";
import { releaseFunds, saveCashBuffer, saveGoalSettings, updateGoalState } from "./actions";

function accountLabel(account: FundingAccount) {
  return account.last_four ? `${account.name} •••• ${account.last_four}` : account.name;
}

export function FundingAccountField({ accounts, selected }: {
  accounts: FundingAccount[];
  selected?: number | null;
}) {
  const options = accounts.filter((account) => account.eligible || account.id === selected);
  const defaultAccount = selected === undefined && options.length === 1 ? options[0].id : selected;
  return <Field label="Bank account">
    <select name="account" defaultValue={defaultAccount ?? ""} required={selected !== null}>
      <option value="" disabled={selected !== null}>{selected === null ? "No linked account" : "Choose an account"}</option>
      {options.map((account) => <option key={account.id} value={account.id}>
        {accountLabel(account)} · {account.available === null ? "Balance unavailable" : `${money(account.available)} available`}
      </option>)}
    </select>
  </Field>;
}

export function AccountReservations({ account }: { account: FundingAccount }) {
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line py-2">
    <strong>{accountLabel(account)}</strong>
    <span>{money(account.reserved)} reserved</span>
    {account.goal_buffer_cents > 0 && <span>{money(account.goal_buffer_cents)} cash buffer</span>}
    <span>{account.available === null ? "Balance unavailable" : `${money(account.available)} available to assign`}</span>
    {Boolean(account.shortfall) && <span className="text-danger">{money(account.shortfall ?? 0)} shortfall</span>}
    {Boolean(account.eligible) && <ButtonLink href={`/goals?buffer=${account.id}`} size="sm"
      aria-label={`Cash buffer for ${accountLabel(account)}`}>Cash buffer</ButtonLink>}
  </div>;
}

export function GoalCard({ goal, account }: { goal: Goal; account?: FundingAccount }) {
  const { id, name, saved_cents: saved, target_cents: target, funding_mode: mode, state } = goal;
  const url = `/goals?goal=${id}&edit=`;
  return <Panel heading={name}>
    {state === "funding" ? <>
      <p>{money(saved)} of {money(target)}</p>
      <progress className="w-full accent-progress" aria-label={name} max={target} value={Math.min(saved, target)} />
      <p className="text-sm text-muted">{saved >= target ? "Goal reached" : `${money(target - saved)} to go`}</p>
    </> : <p>{state === "spending" ? `${money(saved)} left to spend` : "Closed"}</p>}
    {goal.spent_cents > 0 && <p className="text-sm">{money(goal.spent_cents)} spent</p>}
    <p className="mt-2 text-sm text-muted">{mode === "one-time" ? "One-time" : "Refillable"} · {account ? accountLabel(account) : "No linked account"}</p>
    {state !== "closed" && <div className="mt-3 flex flex-wrap gap-2">
      {releasableFunds(goal, account) > 0 && <ButtonLink href={url + "release"} size="sm">Release funds</ButtonLink>}
      <ButtonLink href={url + "settings"} size="sm">Edit goal</ButtonLink>
      {mode === "one-time" && state === "funding" && <form action={updateGoalState}>
        <input type="hidden" name="goal" value={id} />
        <input type="hidden" name="state" value="spending" />
        <Button type="submit" size="sm">Start spending</Button>
      </form>}
      {state === "spending" && <ButtonLink href={url + "close"} size="sm">Close goal</ButtonLink>}
    </div>}
  </Panel>;
}

export function GoalTypeField({ mode = "one-time" }: { mode?: Goal["funding_mode"] }) {
  return <Field label="Goal type">
    <select name="mode" defaultValue={mode}>
      <option value="one-time">One-time</option>
      <option value="refillable">Refillable</option>
    </select>
  </Field>;
}

export function CloseGoalDialog({ goal, notice }: { goal: Goal; notice?: string }) {
  return <GoalDialog title="Close goal" action={updateGoalState} submit="Close goal" notice={notice}>
    <input type="hidden" name="goal" value={goal.id} />
    <input type="hidden" name="state" value="closed" />
    <p>Close {goal.name} and release {money(goal.saved_cents)} in unused funds?</p>
  </GoalDialog>;
}

export function FundingNotice({ notice }: { notice?: string }) {
  return notice && <p role="alert" className="text-sm text-danger">{notice}</p>;
}

export function GoalDialog({ title, action, submit, notice, children }: {
  title: string;
  action: (form: FormData) => Promise<void>;
  submit?: string;
  notice?: string;
  children: ReactNode;
}) {
  return <Modal title={title} closeHref="/goals">
    <form action={action} className="grid gap-3">
      <FundingNotice notice={notice} />
      {children}
      <div className="flex flex-wrap gap-2">
        {submit && <Button type="submit" variant="primary">{submit}</Button>}
        <ButtonLink href="/goals">Cancel</ButtonLink>
      </div>
    </form>
  </Modal>;
}

export function EditGoalDialog({ goal, accounts, notice }: {
  goal: Goal;
  accounts: FundingAccount[];
  notice?: string;
}) {
  return <GoalDialog title="Edit goal" action={saveGoalSettings} submit="Save goal" notice={notice}>
    <input type="hidden" name="goal" value={goal.id} />
    <p className="text-sm text-muted">{goal.name} · {money(goal.saved_cents)} saved</p>
    <FundingAccountField accounts={accounts} selected={goal.account_id} />
    <GoalTypeField mode={goal.funding_mode} />
    <p className="text-sm text-muted">One-time goals pause when you start spending. Refillable goals build back up as funds become available.</p>
  </GoalDialog>;
}

export function ReleaseFundsDialog({ goal, account, notice }: { goal: Goal; account?: FundingAccount; notice?: string }) {
  const maximum = releasableFunds(goal, account);

  return <GoalDialog title="Release funds" action={releaseFunds} submit={maximum > 0 ? "Release funds" : undefined} notice={notice}>
    <input type="hidden" name="goal" value={goal.id} />
    <p className="text-sm text-muted">{goal.name} · {money(goal.saved_cents)} saved</p>
    <p className="text-sm text-muted">{maximum > 0 ? `You can release up to ${money(maximum)}.` : "There are no funds to release."}</p>
    {maximum > 0 && <Field label="Amount">
      <input name="amount" type="number" min="0.01" max={Math.min(maximum, 100_000_000) / 100} step="0.01" required />
    </Field>}
  </GoalDialog>;
}

export function CashBufferDialog({ account, notice }: { account: FundingAccount; notice?: string }) {
  return <GoalDialog title="Cash buffer" action={saveCashBuffer} submit="Save buffer" notice={notice}>
    <input type="hidden" name="account" value={account.id} />
    <p className="text-sm text-muted">Keep this amount available in {accountLabel(account)} before funding goals.</p>
    <Field label="Cash buffer amount">
      <input name="amount" type="number" min="0" max="1000000" step="0.01" required
        defaultValue={(account.goal_buffer_cents / 100).toFixed(2)} />
    </Field>
  </GoalDialog>;
}
