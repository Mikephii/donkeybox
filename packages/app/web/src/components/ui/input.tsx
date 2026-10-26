import * as React from "react"
import { cn } from "cn"

function Input({
  className,
  type,
  inputSize = "default",
  ...props
}: React.ComponentProps<"input"> & {
  /**
   * `sm` is 24px, to sit level with `Button size="sm"` in a dense row.
   * Named `inputSize` rather than `size` because `<input size>` is a real
   * HTML attribute and `InputGroupInput` spreads native props straight
   * through — shadowing it breaks that passthrough.
   */
  inputSize?: "default" | "sm"
}) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={inputSize}
      className={cn(
        "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        inputSize === "sm" ? "h-6 px-2 text-sm" : "h-8",
        className
      )}
      {...props}
    />
  )
}

export { Input }
