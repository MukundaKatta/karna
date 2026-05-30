import { z } from 'zod';
import type { Logger } from 'pino';

/**
 * Issue #530 — Hierarchical task decomposition planner.
 *
 * Models a goal as a directed acyclic graph (DAG) of {@link TaskNode}s linked
 * by dependencies. The {@link TaskTree} validates the graph (unknown deps,
 * self-deps, cycles) and produces a deterministic topological execution order,
 * including "levels" of tasks that can run in parallel. Pure and testable — no
 * execution happens here, only planning.
 */

export const TaskStatusSchema = z.enum(['pending', 'ready', 'running', 'done', 'failed', 'skipped']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskNodeSchema = z.object({
  /** Unique node id within the tree. */
  id: z.string().min(1),
  /** Human-readable goal for this node. */
  goal: z.string().min(1),
  /** Ids of nodes that must complete before this one. */
  deps: z.array(z.string()).default([]),
  /** Current lifecycle status. */
  status: TaskStatusSchema.default('pending'),
  /** Optional id of the agent assigned to this node. */
  assignedTo: z.string().optional(),
  /** Optional free-form metadata. */
  metadata: z.record(z.unknown()).optional(),
});

export type TaskNode = z.infer<typeof TaskNodeSchema>;

/** Error thrown when the dependency graph contains a cycle. */
export class TaskCycleError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`task dependency cycle detected: ${cycle.join(' -> ')}`);
    this.name = 'TaskCycleError';
  }
}

/** Error thrown when a node depends on an id that does not exist. */
export class UnknownDependencyError extends Error {
  constructor(public readonly nodeId: string, public readonly missingDep: string) {
    super(`task "${nodeId}" depends on unknown task "${missingDep}"`);
    this.name = 'UnknownDependencyError';
  }
}

/**
 * A validated DAG of tasks. Construct via {@link TaskTree.from} which parses,
 * validates, and detects cycles up front so all later queries are safe.
 */
export class TaskTree {
  private readonly nodes: Map<string, TaskNode>;
  /** Adjacency: nodeId -> dependents (ids that depend on it). */
  private readonly dependents: Map<string, string[]>;

  private constructor(nodes: TaskNode[], private readonly logger?: Logger) {
    this.nodes = new Map(nodes.map((n) => [n.id, n]));
    this.dependents = new Map(nodes.map((n) => [n.id, []]));
    for (const n of nodes) {
      for (const d of n.deps) {
        this.dependents.get(d)!.push(n.id);
      }
    }
  }

  /**
   * Build and validate a task tree from raw node inputs. Validates schema,
   * checks for duplicate ids, unknown deps, self-deps, and cycles.
   */
  static from(rawNodes: unknown[], logger?: Logger): TaskTree {
    const parsed = rawNodes.map((n) => TaskNodeSchema.parse(n));

    const ids = new Set<string>();
    for (const n of parsed) {
      if (ids.has(n.id)) throw new Error(`duplicate task id: ${n.id}`);
      ids.add(n.id);
    }

    for (const n of parsed) {
      for (const d of n.deps) {
        if (d === n.id) throw new Error(`task "${n.id}" cannot depend on itself`);
        if (!ids.has(d)) throw new UnknownDependencyError(n.id, d);
      }
    }

    const tree = new TaskTree(parsed, logger);
    tree.assertAcyclic();
    return tree;
  }

  get size(): number {
    return this.nodes.size;
  }

  getNode(id: string): TaskNode | undefined {
    const n = this.nodes.get(id);
    return n ? { ...n } : undefined;
  }

  getNodes(): TaskNode[] {
    return [...this.nodes.values()].map((n) => ({ ...n }));
  }

  /** Direct dependents (ids whose deps include `id`). */
  dependentsOf(id: string): string[] {
    return [...(this.dependents.get(id) ?? [])];
  }

  /** Detect a cycle and throw {@link TaskCycleError} if found. */
  private assertAcyclic(): void {
    const cycle = this.findCycle();
    if (cycle) {
      this.logger?.warn({ cycle }, 'task dependency cycle');
      throw new TaskCycleError(cycle);
    }
  }

  /**
   * Returns a cycle path if one exists, else null. Uses DFS with a recursion
   * stack; the returned path starts and ends at the repeated node.
   */
  private findCycle(): string[] | null {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const stack: string[] = [];
    for (const id of this.nodes.keys()) color.set(id, WHITE);

    const visit = (id: string): string[] | null => {
      color.set(id, GRAY);
      stack.push(id);
      for (const dep of this.nodes.get(id)!.deps) {
        const c = color.get(dep);
        if (c === GRAY) {
          // Found a back-edge: build the cycle from the stack.
          const start = stack.indexOf(dep);
          return [...stack.slice(start), dep];
        }
        if (c === WHITE) {
          const found = visit(dep);
          if (found) return found;
        }
      }
      stack.pop();
      color.set(id, BLACK);
      return null;
    };

    for (const id of this.nodes.keys()) {
      if (color.get(id) === WHITE) {
        const found = visit(id);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Topological execution order (Kahn's algorithm). Deterministic: ties are
   * broken by insertion order. Throws {@link TaskCycleError} if the graph is
   * cyclic (defensive — `from` already validates).
   */
  topologicalOrder(): string[] {
    const indegree = new Map<string, number>();
    for (const n of this.nodes.values()) indegree.set(n.id, n.deps.length);

    const ready = [...this.nodes.values()].filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
    const order: string[] = [];

    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      for (const dependent of this.dependentsOf(id)) {
        const next = indegree.get(dependent)! - 1;
        indegree.set(dependent, next);
        if (next === 0) ready.push(dependent);
      }
    }

    if (order.length !== this.nodes.size) {
      const remaining = [...this.nodes.keys()].filter((id) => !order.includes(id));
      throw new TaskCycleError(remaining);
    }
    return order;
  }

  /**
   * Group tasks into dependency "levels": all tasks in level N depend only on
   * tasks in levels < N. Tasks within a level can be executed in parallel.
   * Deterministic ordering within each level (insertion order).
   */
  executionLevels(): string[][] {
    const indegree = new Map<string, number>();
    for (const n of this.nodes.values()) indegree.set(n.id, n.deps.length);

    const levels: string[][] = [];
    let frontier = [...this.nodes.values()].filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
    let visited = 0;

    while (frontier.length > 0) {
      levels.push(frontier);
      visited += frontier.length;
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        for (const dependent of this.dependentsOf(id)) {
          const next = indegree.get(dependent)! - 1;
          indegree.set(dependent, next);
          if (next === 0) nextFrontier.push(dependent);
        }
      }
      frontier = nextFrontier;
    }

    if (visited !== this.nodes.size) {
      const remaining = [...this.nodes.keys()].filter((id) => !levels.flat().includes(id));
      throw new TaskCycleError(remaining);
    }
    return levels;
  }

  /** Ids whose deps are all in `completed` and are not themselves completed. */
  readyTasks(completed: Iterable<string>): string[] {
    const done = new Set(completed);
    return [...this.nodes.values()]
      .filter((n) => !done.has(n.id) && n.deps.every((d) => done.has(d)))
      .map((n) => n.id);
  }
}
