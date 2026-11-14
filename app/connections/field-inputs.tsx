import { Field } from "../../components/ui/field";
import { Select } from "../../components/ui/select";
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
          ? <Select name={name} defaultValue={field.value ?? ""} required={field.required}
            placeholder={field.required ? "Choose an option" : "Not set"}
            options={field.required ? field.choices ?? [] : [{ value: "", label: "Not set" }, ...field.choices ?? []]} />
          : field.kind === "file"
            ? <textarea name={name} rows={4} placeholder={placeholder} required={required} autoComplete="off" />
            : <input name={name} type={field.kind === "secret" ? "password" : "text"} autoComplete="off"
                defaultValue={field.kind === "text" ? field.value ?? "" : undefined} placeholder={placeholder} required={required} />}
      </Field>;
    })}
  </>;
}
