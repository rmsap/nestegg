import type { ComponentProps, ReactNode } from "react";

export const panelSurface = "min-w-0 rounded-[14px] border border-line p-[clamp(15px,2vw,22px)]";

export function Panel({ heading, headingAside, children, className, ...props }: ComponentProps<"section"> & {
  heading?: string;
  headingAside?: ReactNode;
}) {
  return <section {...props} className={`${panelSurface} bg-surface ${className ?? ""}`}>
    {headingAside != null
      ? <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {heading && <h2>{heading}</h2>}
        {headingAside}
      </div>
      : heading && <h2>{heading}</h2>}
    {children}
  </section>;
}
