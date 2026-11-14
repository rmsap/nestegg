import type { ComponentProps } from "react";

type ChipProps =
  | ({ as?: "span" } & ComponentProps<"span">)
  | ({ as: "button" } & ComponentProps<"button">);

export function Chip(props: ChipProps) {
  const surface = "inline-block max-w-full rounded-full border border-transparent bg-accent px-[9px] py-[3px] text-left text-[.8rem]/[1.4] font-bold wrap-anywhere text-green";
  if (props.as === "button") {
    const { as, className, ...buttonProps } = props;
    return <button type="button" {...buttonProps}
      className={`${surface} cursor-pointer touch-manipulation select-none hover:border-green pointer-coarse:min-h-11 ${className ?? ""}`} />;
  }
  const { as, className, ...spanProps } = props;
  return <span {...spanProps} className={`${surface} ${className ?? ""}`} />;
}
