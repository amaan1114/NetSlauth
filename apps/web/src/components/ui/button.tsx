"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border border-[#9bc9ad] bg-[#a8d7bd] text-[#14251c] hover:bg-[#b9e1ca]",
        secondary: "border border-[#354146] bg-[#20282b] text-[#d2dcda] hover:bg-[#293438]",
        ghost: "text-[#9aa7a7] hover:bg-[#222c31] hover:text-[#e2e9e7]",
        danger: "border border-[#694240] bg-[#2b1e1f] text-[#e4a19b] hover:bg-[#382526]",
      },
      size: {
        default: "min-h-9 px-3.5",
        sm: "min-h-8 px-2.5",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonStyles> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonStyles({ variant, size }), className)} {...props} />;
}
