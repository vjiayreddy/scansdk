import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "destructive"
  | "ghost"
  | "onColor";

type ButtonSize = "default" | "sm" | "lg" | "icon";

const variantClass: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--primary)] text-[var(--primary-foreground)] active:bg-[var(--color-primary-active)]",
  secondary:
    "bg-[var(--background)] text-[var(--foreground)] border border-[var(--border)] active:bg-[var(--surface)]",
  outline:
    "bg-transparent text-[var(--foreground)] border border-[var(--border)]",
  destructive:
    "bg-[var(--destructive)] text-[var(--destructive-foreground)] active:opacity-90",
  ghost:
    "bg-transparent text-[var(--foreground)] hover:bg-[var(--surface)] active:bg-[var(--surface)]",
  onColor: "bg-[var(--color-canvas)] text-[var(--color-ink)] active:opacity-90",
};

const sizeClass: Record<ButtonSize, string> = {
  default: "h-11 rounded-md px-5",
  sm: "h-9 rounded-md px-4 text-xs",
  lg: "h-12 rounded-md px-6",
  icon: "size-10 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-[var(--color-primary-disabled)] disabled:text-[var(--muted)]",
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  );
}
