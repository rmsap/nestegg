import Link from "next/link";
import type { ComponentProps } from "react";

type ButtonStyle = {
  variant?: "default" | "primary" | "danger";
  className?: string;
};

function buttonClass({ variant = "default", className }: ButtonStyle) {
  const variants = {
    default: "border-line bg-surface text-ink",
    primary: "border-primary bg-primary text-on-primary",
    danger: "border-danger bg-danger text-on-danger",
  };
  return `inline-block cursor-pointer rounded-lg border px-3 py-2 ${variants[variant]} ${className ?? ""}`;
}

export function Button({ variant, className, ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClass({ variant, className })} />;
}

export function ButtonLink({ variant, className, ...props }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClass({ variant, className })} />;
}
