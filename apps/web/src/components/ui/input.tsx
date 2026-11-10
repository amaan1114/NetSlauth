import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-[42px] w-full rounded-md border border-[#354146] bg-[#171f22] px-3 text-[13px] text-[#e2e9e7] outline-none placeholder:text-[#667477] focus:border-[#638975] focus:ring-2 focus:ring-[#79b091]/10",
        className,
      )}
      {...props}
    />
  );
}
