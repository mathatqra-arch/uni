import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("uk-skeleton-shimmer rounded-xl", className)}
      {...props}
    />
  )
}

export { Skeleton }