import { cn } from "@workspace/ui/lib/utils"

interface Props {
  size?: "sm" | "md"
  className?: string
}

const KowalskyMark = ({ size = "sm", className }: Props) => {
  const dim = size === "sm" ? "size-5" : "size-7"
  const text = size === "sm" ? "text-[10px]" : "text-xs"
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-border bg-orange-500 font-semibold text-white",
        dim,
        text,
        className,
      )}
    >
      K
    </span>
  )
}

export default KowalskyMark