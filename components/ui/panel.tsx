import type { ComponentProps, ReactNode } from "react";

export function Panel({ heading, headingAside, children, className, ...props }: ComponentProps<"section"> & {
  heading?: string;
  headingAside?: ReactNode;
}) {
  return <section {...props} className={className ? `panel ${className}` : "panel"}>
    {headingAside != null
      ? <div className="section-heading">
        {heading && <h2>{heading}</h2>}
        {headingAside}
      </div>
      : heading && <h2>{heading}</h2>}
    {children}
  </section>;
}
