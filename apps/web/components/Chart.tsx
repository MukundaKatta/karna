"use client";

import {
  LineChart as RechartsLine,
  Line,
  BarChart as RechartsBar,
  Bar,
  PieChart as RechartsPie,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const COLORS = [
  "#6366f1", // accent
  "#22c55e", // success
  "#f59e0b", // warning
  "#ef4444", // danger
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#14b8a6", // teal
];

interface ChartBaseProps {
  data: Array<Record<string, unknown>>;
  height?: number;
  className?: string;
}

interface LineChartProps extends ChartBaseProps {
  xKey: string;
  yKeys: Array<{ key: string; color?: string; name?: string }>;
}

export function LineChart({ data, xKey, yKeys, height = 300, className }: LineChartProps) {
  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RechartsLine data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey={xKey}
            stroke="#64748b"
            tick={{ fill: "#64748b", fontSize: 12 }}
          />
          <YAxis stroke="#64748b" tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#e2e8f0",
            }}
          />
          <Legend />
          {yKeys.map((yk, i) => (
            <Line
              key={yk.key}
              type="monotone"
              dataKey={yk.key}
              name={yk.name ?? yk.key}
              stroke={yk.color ?? COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </RechartsLine>
      </ResponsiveContainer>
    </div>
  );
}

interface BarChartProps extends ChartBaseProps {
  xKey: string;
  yKeys: Array<{ key: string; color?: string; name?: string }>;
  stacked?: boolean;
}

export function BarChart({ data, xKey, yKeys, stacked, height = 300, className }: BarChartProps) {
  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RechartsBar data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey={xKey}
            stroke="#64748b"
            tick={{ fill: "#64748b", fontSize: 12 }}
          />
          <YAxis stroke="#64748b" tick={{ fill: "#64748b", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#e2e8f0",
            }}
          />
          <Legend />
          {yKeys.map((yk, i) => (
            <Bar
              key={yk.key}
              dataKey={yk.key}
              name={yk.name ?? yk.key}
              fill={yk.color ?? COLORS[i % COLORS.length]}
              stackId={stacked ? "stack" : undefined}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </RechartsBar>
      </ResponsiveContainer>
    </div>
  );
}

interface PieChartProps extends ChartBaseProps {
  dataKey: string;
  nameKey: string;
  colors?: string[];
}

export function PieChart({ data, dataKey, nameKey, colors, height = 300, className }: PieChartProps) {
  const fillColors = colors ?? COLORS;
  return (
    <div className={className} style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <RechartsPie>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            dataKey={dataKey}
            nameKey={nameKey}
            paddingAngle={2}
            label={({ name, percent }: { name: string; percent: number }) =>
              `${name}: ${(percent * 100).toFixed(0)}%`
            }
          >
            {data.map((_, i) => (
              <Cell key={i} fill={fillColors[i % fillColors.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "8px",
              color: "#e2e8f0",
            }}
          />
          <Legend />
        </RechartsPie>
      </ResponsiveContainer>
    </div>
  );
}
