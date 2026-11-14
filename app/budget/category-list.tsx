import { Button, ButtonLink } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Panel } from "../../components/ui/panel";
import { addCategory, deleteCategory, saveLimits } from "./actions";
import type { Category } from "../../server/budget/queries";
import { money } from "../../lib/finance";

export function CategoryList({ list, editing, month }: { list: Category[]; editing: boolean; month: string }) {
  const url = "/budget?month=" + month;
  return <>
    <Panel heading="Your categories" headingAside={editing ? <div className="actions">
      <ButtonLink href={url}>Cancel</ButtonLink>
      <Button type="submit" variant="primary" form="limits">Save changes</Button>
    </div> : <ButtonLink href={url + "&edit=1"}>Edit categories</ButtonLink>}>
      {editing && <form id="limits" action={saveLimits}><input type="hidden" name="month" value={month} /></form>}
      {list.length === 0 && <p className="muted">Add a category to start your budget.</p>}
      {list.map((category) => {
        const alternatives = list.filter((item) => item.id !== category.id);
        const remaining = category.limit_cents - category.spent;
        return <div className="budget-row" key={category.id}>
          <div className="category-row">
            {editing && <details className="remove">
              <summary aria-label={`Delete ${category.name} category`}>×</summary>
              <div className="remove-panel">
                <strong>Delete {category.name}?</strong>
                <p className="muted">This removes the category and its limits for all months.</p>
                {category.activity > 0 && alternatives.length === 0
                  ? <p>Add another category so these transactions have somewhere to go.</p>
                  : <form action={deleteCategory}>
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="category" value={category.id} />
                    {category.activity > 0 && <Field label="Move transactions to">
                      <select name="replacement" required defaultValue="">
                        <option value="" disabled>Choose a category</option>
                        {alternatives.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                    </Field>}
                    <Button type="submit" variant="danger">Delete category</Button>
                  </form>}
              </div>
            </details>}
            <h3>{category.name}</h3>
            <div className="amount">{money(category.spent)} / {editing
              ? <input form="limits" name={`limit-${category.id}`} aria-label={`${category.name} monthly limit`}
                  type="number" min="0" max="1000000" step="0.01" required defaultValue={(category.limit_cents / 100).toFixed(2)} />
              : money(category.limit_cents)}</div>
          </div>
          <div className="track" aria-hidden="true"><div className={remaining < 0 ? "over" : ""} style={{
            width: `${Math.min(100, Math.max(0, category.spent / Math.max(1, category.limit_cents) * 100))}%`,
          }} /></div>
          <p className="muted">{money(Math.abs(remaining))} {remaining < 0 ? "over budget" : "remaining"}</p>
        </div>;
      })}
    </Panel>
    <Panel heading="Add a category">
      <form className="fields" action={addCategory}>
        <input type="hidden" name="month" value={month} />
        <Field label="Category name"><input name="name" maxLength={60} required /></Field>
        <Field label="Monthly limit">
          <input name="limit" type="number" min="0" max="1000000" step="0.01" defaultValue="0" required />
        </Field>
        <Button type="submit" variant="primary">Add category</Button>
      </form>
    </Panel>
  </>;
}
