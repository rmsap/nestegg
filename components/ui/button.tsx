import Link from "next/link";
import type { ComponentProps } from "react";

type ButtonStyle = {
  variant?: "default" | "primary" | "danger";
  size?: "md" | "sm";
  className?: string;
};

export function buttonClass({ variant = "default", size = "md", className }: ButtonStyle) {
  const variants = {
    default: "border-line bg-surface text-ink",
    primary: "border-primary bg-primary text-on-primary",
    danger: "border-danger bg-danger text-on-danger",
  };
  const sizes = {
    md: "px-3 py-2",
    sm: "px-2.5 py-1 text-sm pointer-coarse:min-h-11",
  };
  return `inline-flex cursor-pointer items-center gap-1.5 rounded-lg border ${sizes[size]} ${variants[variant]} ${className ?? ""}`;
}

export function Button({ variant, size, className, ...props }: ComponentProps<"button"> & ButtonStyle) {
  return <button {...props} className={buttonClass({ variant, size, className })} />;
}

export function ButtonLink({ variant, size, className, ...props }: ComponentProps<typeof Link> & ButtonStyle) {
  return <Link {...props} className={buttonClass({ variant, size, className })} />;
}
