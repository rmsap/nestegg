import type { ComponentProps } from "react";

export function Switch({ label, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: string }) {
  return <label className={className ? `switch ${className}` : "switch"}>
    <input {...props} type="checkbox" role="switch" />
    <span className="switch-track" aria-hidden="true" />
    {label}
  </label>;
}
