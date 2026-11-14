import type { ComponentProps, CSSProperties } from "react";
import { themeVariables } from "../../lib/theme";

type ChipProps = { color?: string } & (
  | ({ as?: "span" } & ComponentProps<"span">)
  | ({ as: "button" } & ComponentProps<"button">));

export function Chip(props: ChipProps) {
  const palette = props.color ? themeVariables(props.color) : undefined;
  const colors = palette ? "border-primary-border bg-primary text-on-primary" : "border-transparent bg-accent text-primary-text";
  const surface = `inline-block max-w-full rounded-full border px-[9px] py-[3px] text-left text-[.8rem]/[1.4] font-bold wrap-anywhere ${colors}`;
  if (props.as === "button") {
    const { as, color, className, style, ...buttonProps } = props;
    return <button type="button" {...buttonProps} style={{ ...palette, ...style } as CSSProperties}
      className={`${surface} cursor-pointer touch-manipulation select-none hover:border-primary-text pointer-coarse:min-h-11 ${className ?? ""}`} />;
  }
  const { as, color, className, style, ...spanProps } = props;
  return <span {...spanProps} style={{ ...palette, ...style } as CSSProperties}
    className={`${surface} ${className ?? ""}`} />;
}
