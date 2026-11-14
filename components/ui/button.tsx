import Link from "next/link";
import type { ComponentProps } from "react";

type ButtonStyle = {
  variant?: "default" | "primary" | "danger";
  className?: string;
};

function buttonClass({ variant = "default", className }: ButtonStyle) {
  return ["button", variant !== "default" && variant, className].filter(Boolean).join(" ");
}

export function Button({ variant, className, ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClass({ variant, className })} />;
}

export function ButtonLink({ variant, className, ...props }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClass({ variant, className })} />;
}
