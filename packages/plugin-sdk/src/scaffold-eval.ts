/**
 * Eval-suite scaffolding for skills (Issue #617).
 *
 * Pure functions that return file *text* for a starter eval suite, intended to
 * be written next to a scaffolded skill. Includes a tiny default task that
 * passes out of the box so newly-scaffolded skills have a green baseline.
 */

export interface EvalScaffoldOptions {
  /** Skill name (used in identifiers, file naming, and task descriptions). */
  name: string;
  /** Optional test-runner import specifier. Default '@karna/plugin-sdk'. */
  sdkImport?: string;
}

/** A single scaffolded file: relative path + contents. */
export interface ScaffoldedFile {
  path: string;
  content: string;
}

function toCamel(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return 'skill';
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  );
}

function safeFileBase(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug || 'skill';
}

/**
 * Returns the contents of an eval-tasks JSON fixture. Each task has an input,
 * an expectation, and a free-form description. Ships one trivial passing task.
 */
export function generateEvalTasks(name: string): string {
  const tasks = [
    {
      id: 'smoke-1',
      description: `${name} returns a non-empty string for basic input`,
      input: 'hello',
      // The default scorer only checks the output is a non-empty string.
      expect: { kind: 'non-empty' },
    },
    {
      id: 'echo-contains',
      description: `${name} output should reference the input (customize me)`,
      input: 'ping',
      expect: { kind: 'contains', value: 'ping' },
    },
  ];
  return JSON.stringify({ skill: name, tasks }, null, 2) + '\n';
}

/**
 * Returns a trivial scorer module. The scorer supports two expectation kinds:
 * `non-empty` and `contains`. Returns a number in [0, 1].
 */
export function generateEvalScorer(name: string): string {
  const fn = `score${toCamel(name).charAt(0).toUpperCase()}${toCamel(name).slice(1)}`;
  return `/**
 * Trivial scorer for the "${name}" skill eval suite.
 * Returns a score in [0, 1]. Extend with your own expectation kinds.
 */
export type Expectation =
  | { kind: 'non-empty' }
  | { kind: 'contains'; value: string }
  | { kind: 'equals'; value: string };

export function ${fn}(output: unknown, expect: Expectation): number {
  const text = typeof output === 'string' ? output : String(output ?? '');
  switch (expect.kind) {
    case 'non-empty':
      return text.trim().length > 0 ? 1 : 0;
    case 'contains':
      return text.includes(expect.value) ? 1 : 0;
    case 'equals':
      return text === expect.value ? 1 : 0;
    default:
      return 0;
  }
}
`;
}

/**
 * Returns a runnable Vitest spec that loads the tasks, runs the skill, and
 * scores each task. The default trivial task passes immediately.
 */
export function generateEvalSpec(opts: EvalScaffoldOptions): string {
  const { name } = opts;
  const base = safeFileBase(name);
  const scorerFn = `score${toCamel(name).charAt(0).toUpperCase()}${toCamel(name).slice(1)}`;
  return `import { describe, it, expect } from 'vitest';
import tasksFixture from './${base}.eval.tasks.json' assert { type: 'json' };
import { ${scorerFn}, type Expectation } from './${base}.eval.scorer.js';
// TODO: import your skill, e.g.:
// import { ${toCamel(name)}Skill } from './${base}.js';

interface EvalTask {
  id: string;
  description: string;
  input: string;
  expect: Expectation;
}

const { tasks } = tasksFixture as { tasks: EvalTask[] };

// Replace this stub with your real skill execution.
async function runSkill(input: string): Promise<string> {
  // return await ${toCamel(name)}Skill.execute({ input, args: {}, logger: console });
  return input; // trivial passing default
}

describe('${name} eval suite', () => {
  for (const task of tasks) {
    it(task.description, async () => {
      const output = await runSkill(task.input);
      const score = ${scorerFn}(output, task.expect);
      expect(score).toBeGreaterThanOrEqual(task.expect.kind === 'non-empty' ? 1 : 0);
    });
  }
});
`;
}

/**
 * Convenience: returns the complete set of files for a skill's eval suite,
 * ready to be written to disk next to the skill.
 */
export function scaffoldEvalSuite(opts: EvalScaffoldOptions): ScaffoldedFile[] {
  const base = safeFileBase(opts.name);
  return [
    { path: `${base}.eval.tasks.json`, content: generateEvalTasks(opts.name) },
    { path: `${base}.eval.scorer.ts`, content: generateEvalScorer(opts.name) },
    { path: `${base}.eval.test.ts`, content: generateEvalSpec(opts) },
  ];
}
