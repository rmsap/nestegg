import { Field } from "../../components/ui/field";
import type { SettingField } from "../../server/imports/transaction-provider";

export type FieldState = SettingField & { set?: boolean; value?: string };

export function FieldInputs({ fields, prefix }: { fields: FieldState[]; prefix: string }) {
  return <>
    {fields.map((field) => {
      const name = prefix + field.name;
      const placeholder = field.set ? "Saved. Leave blank to keep." : undefined;
      const required = field.required && !field.set;
      return <Field key={field.name} label={field.label}>
        {field.kind === "choice"
          ? <select name={name} defaultValue={field.value ?? ""} required={field.required}>
            <option value="" disabled={field.required}>{field.required ? "Choose an option" : "Not set"}</option>
            {field.choices?.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
          </select>
          : field.kind === "file"
            ? <textarea name={name} rows={4} placeholder={placeholder} required={required} autoComplete="off" />
            : <input name={name} type={field.kind === "secret" ? "password" : "text"} autoComplete="off"
                defaultValue={field.kind === "text" ? field.value ?? "" : undefined} placeholder={placeholder} required={required} />}
      </Field>;
    })}
  </>;
}
