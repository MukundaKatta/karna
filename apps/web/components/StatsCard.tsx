import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: any;
  trend?: {
    value: number;
    label: string;
  };
  className?: string;
}

export function StatsCard({ title, value, icon, trend, className }: StatsCardProps) {
  const trendDirection = trend
    ? trend.value > 0
      ? "up"
      : trend.value < 0
        ? "down"
        : "flat"
    : null;

  return (
    <div
      className={cn(
        "group rounded-xl border border-dark-700 bg-dark-800 p-5",
        "transition-all duration-200 hover:border-dark-600 hover:bg-dark-800/80",
        "hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm text-dark-400">{title}</p>
          <p className="text-2xl font-semibold text-white tabular-nums tracking-tight">
            {value}
          </p>
        </div>
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg",
            "bg-dark-700 text-dark-300 transition-colors duration-200",
            "group-hover:bg-accent-600/15 group-hover:text-accent-400",
          )}
        >
          {icon}
        </div>
      </div>
      {trend && (
        <div className="flex items-center gap-1.5 mt-3 text-xs">
          {trendDirection === "up" && (
            <TrendingUp size={14} className="text-success-400" />
          )}
          {trendDirection === "down" && (
            <TrendingDown size={14} className="text-danger-400" />
          )}
          {trendDirection === "flat" && (
            <Minus size={14} className="text-dark-400" />
          )}
          <span
            className={cn(
              "font-medium",
              trendDirection === "up" && "text-success-400",
              trendDirection === "down" && "text-danger-400",
              trendDirection === "flat" && "text-dark-400",
            )}
          >
            {trend.value > 0 ? "+" : ""}
            {trend.value}%
          </span>
          <span className="text-dark-400">{trend.label}</span>
        </div>
      )}
    </div>
  );
}
