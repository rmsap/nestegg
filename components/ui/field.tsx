import type { ComponentProps } from "react";

export function Field({ label, children, ...props }: ComponentProps<"label"> & { label: string }) {
  return <label {...props}>
    {label}
    {children}
  </label>;
}
