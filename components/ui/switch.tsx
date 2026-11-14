import type { ComponentProps } from "react";

export function Switch({ label, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: string }) {
  return <label className={`relative flex w-fit cursor-pointer items-center gap-2 pointer-coarse:min-h-11 ${className ?? ""}`}>
    <input {...props} type="checkbox" role="switch" className="peer sr-only" />
    <span className="relative h-6 w-10 shrink-0 rounded-full bg-control transition-colors peer-checked:bg-primary peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-focus peer-disabled:cursor-not-allowed peer-disabled:opacity-50 motion-reduce:transition-none after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow-popover after:transition-transform peer-checked:after:translate-x-4 motion-reduce:after:transition-none"
      aria-hidden="true" />
    {label}
  </label>;
}
