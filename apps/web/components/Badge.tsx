import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "accent";

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-dark-700 text-dark-300",
  success: "bg-success-500/20 text-success-400",
  warning: "bg-warning-500/20 text-warning-400",
  danger: "bg-danger-500/20 text-danger-400",
  info: "bg-blue-500/20 text-blue-400",
  accent: "bg-accent-600/20 text-accent-400",
};

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
