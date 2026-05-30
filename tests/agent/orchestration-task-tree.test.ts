import { describe, it, expect } from 'vitest';
import {
  TaskTree,
  TaskCycleError,
  UnknownDependencyError,
} from '../../agent/src/orchestration/task-tree.js';

describe('TaskTree.from validation', () => {
  it('parses nodes and applies schema defaults', () => {
    const tree = TaskTree.from([{ id: 'a', goal: 'do a' }]);
    expect(tree.size).toBe(1);
    const node = tree.getNode('a');
    expect(node?.deps).toEqual([]);
    expect(node?.status).toBe('pending');
  });

  it('throws on duplicate ids', () => {
    expect(() => TaskTree.from([
      { id: 'a', goal: 'x' },
      { id: 'a', goal: 'y' },
    ])).toThrow(/duplicate task id/);
  });

  it('throws on self-dependency', () => {
    expect(() => TaskTree.from([{ id: 'a', goal: 'x', deps: ['a'] }])).toThrow(/cannot depend on itself/);
  });

  it('throws UnknownDependencyError on missing dep', () => {
    expect(() => TaskTree.from([{ id: 'a', goal: 'x', deps: ['ghost'] }]))
      .toThrow(UnknownDependencyError);
  });

  it('throws TaskCycleError on a cycle', () => {
    let err: unknown;
    try {
      TaskTree.from([
        { id: 'a', goal: 'x', deps: ['b'] },
        { id: 'b', goal: 'y', deps: ['a'] },
      ]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TaskCycleError);
    expect((err as TaskCycleError).cycle.length).toBeGreaterThan(0);
  });
});

describe('TaskTree ordering', () => {
  // a -> b, a -> c, b -> d, c -> d  (diamond)
  function diamond(): TaskTree {
    return TaskTree.from([
      { id: 'a', goal: 'root' },
      { id: 'b', goal: 'left', deps: ['a'] },
      { id: 'c', goal: 'right', deps: ['a'] },
      { id: 'd', goal: 'join', deps: ['b', 'c'] },
    ]);
  }

  it('topologicalOrder respects dependencies', () => {
    const order = diamond().topologicalOrder();
    expect(order[0]).toBe('a');
    expect(order[order.length - 1]).toBe('d');
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('executionLevels groups parallelizable tasks', () => {
    const levels = diamond().executionLevels();
    expect(levels[0]).toEqual(['a']);
    expect(levels[1].sort()).toEqual(['b', 'c']);
    expect(levels[2]).toEqual(['d']);
  });

  it('dependentsOf reports reverse edges', () => {
    expect(diamond().dependentsOf('a').sort()).toEqual(['b', 'c']);
    expect(diamond().dependentsOf('d')).toEqual([]);
  });

  it('readyTasks returns tasks whose deps are satisfied', () => {
    const tree = diamond();
    expect(tree.readyTasks([])).toEqual(['a']);
    expect(tree.readyTasks(['a']).sort()).toEqual(['b', 'c']);
    expect(tree.readyTasks(['a', 'b']).sort()).toEqual(['c']);
    expect(tree.readyTasks(['a', 'b', 'c'])).toEqual(['d']);
  });

  it('handles independent tasks at the same level', () => {
    const tree = TaskTree.from([
      { id: 'x', goal: 'x' },
      { id: 'y', goal: 'y' },
    ]);
    expect(tree.executionLevels()).toEqual([['x', 'y']]);
  });
});
