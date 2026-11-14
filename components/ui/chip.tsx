import type { ComponentProps } from "react";

type ChipProps =
  | ({ as?: "span" } & ComponentProps<"span">)
  | ({ as: "button" } & ComponentProps<"button">);

export function Chip(props: ChipProps) {
  if (props.as === "button") {
    const { as, className, ...buttonProps } = props;
    return <button type="button" {...buttonProps}
      className={`chip chip-button ${className ?? ""}`} />;
  }
  const { as, className, ...spanProps } = props;
  return <span {...spanProps} className={`chip ${className ?? ""}`} />;
}
