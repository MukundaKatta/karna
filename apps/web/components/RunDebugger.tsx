"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import {
  filterByPhase,
  formatValue,
  phasesPresent,
  type RunStep,
  type StepPhase,
} from "@/components/runTrace";

const phaseVariant: Record<
  StepPhase,
  "default" | "success" | "warning" | "danger" | "info" | "accent"
> = {
  context: "info",
  "tool-selection": "accent",
  model: "default",
  "tool-call": "warning",
  memory: "success",
  response: "default",
  other: "default",
};

export function RunDebugger({ steps }: { steps: RunStep[] }) {
  const [phase, setPhase] = useState<StepPhase | "all">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const phases = useMemo(() => phasesPresent(steps), [steps]);
  const visible = useMemo(() => filterByPhase(steps, phase), [steps, phase]);

  function toggle(index: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  if (steps.length === 0) {
    return (
      <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
        No trace steps for this run.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label={`All (${steps.length})`}
          active={phase === "all"}
          onClick={() => setPhase("all")}
        />
        {phases.map((p) => (
          <FilterChip
            key={p}
            label={p}
            active={phase === p}
            onClick={() => setPhase(p)}
          />
        ))}
      </div>

      <div className="space-y-3">
        {visible.map((step) => {
          const open = expanded.has(step.index);
          return (
            <div
              key={step.index}
              className="rounded-xl border border-dark-700 bg-dark-800"
            >
              <button
                onClick={() => toggle(step.index)}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-dark-500">#{step.index}</span>
                  <Badge variant={phaseVariant[step.phase]}>{step.phase}</Badge>
                  <span className="text-sm text-white">{step.label}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-dark-500">
                  {step.toolCalls.length > 0 && (
                    <span>{step.toolCalls.length} tool</span>
                  )}
                  {step.memoryOps.length > 0 && (
                    <span>{step.memoryOps.length} mem</span>
                  )}
                  <span>{open ? "−" : "+"}</span>
                </div>
              </button>

              {open && (
                <div className="space-y-4 border-t border-dark-700 px-5 py-4">
                  {step.context && (
                    <Section title="Assembled context">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-dark-900/70 p-3 text-xs text-dark-300">
                        {step.context}
                      </pre>
                    </Section>
                  )}

                  {step.selectedTools && step.selectedTools.length > 0 && (
                    <Section title="Selected tools">
                      <div className="flex flex-wrap gap-2">
                        {step.selectedTools.map((tool) => (
                          <span
                            key={tool}
                            className="rounded-md bg-dark-700 px-2 py-1 font-mono text-xs text-dark-300"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </Section>
                  )}

                  {step.toolCalls.map((call, i) => (
                    <Section key={i} title={`Tool call — ${call.name}`}>
                      {call.durationMs != null && (
                        <p className="mb-2 text-xs text-dark-500">{call.durationMs} ms</p>
                      )}
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-medium text-dark-400">Args</p>
                          <pre className="max-h-60 overflow-auto rounded-lg bg-dark-900/70 p-3 text-xs text-dark-300">
                            {formatValue(call.args) || "—"}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-medium text-dark-400">
                            {call.error ? "Error" : "Result"}
                          </p>
                          <pre
                            className={cn(
                              "max-h-60 overflow-auto rounded-lg bg-dark-900/70 p-3 text-xs",
                              call.error ? "text-danger-400" : "text-dark-300",
                            )}
                          >
                            {call.error ?? (formatValue(call.result) || "—")}
                          </pre>
                        </div>
                      </div>
                    </Section>
                  ))}

                  {step.memoryOps.length > 0 && (
                    <Section title="Memory operations">
                      <ul className="space-y-1">
                        {step.memoryOps.map((mem, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-2 text-xs text-dark-400"
                          >
                            <Badge variant="success">{mem.op}</Badge>
                            {mem.tier && <span className="text-dark-500">{mem.tier}</span>}
                            {mem.content && (
                              <span className="font-mono text-dark-300">{mem.content}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs transition-colors",
        active
          ? "bg-accent-600/20 text-accent-400"
          : "bg-dark-800 text-dark-400 hover:bg-dark-700 hover:text-white",
      )}
    >
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-dark-500">
        {title}
      </h3>
      {children}
    </div>
  );
}
