import { describe, it, expect } from 'vitest';
import {
  normalizeApprovals,
  formatArgs,
  parseEditedArgs,
  riskBadgeVariant,
} from '../../apps/web/components/approvals';

describe('normalizeApprovals', () => {
  it('handles array payloads', () => {
    const out = normalizeApprovals([
      { id: 'a1', toolName: 'shell', riskLevel: 'high', args: { cmd: 'ls' } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].toolName).toBe('shell');
    expect(out[0].args).toEqual({ cmd: 'ls' });
    expect(out[0].status).toBe('pending');
  });

  it('handles wrapped { approvals } and { pending } payloads', () => {
    expect(normalizeApprovals({ approvals: [{ id: 'x' }] })).toHaveLength(1);
    expect(normalizeApprovals({ pending: [{ id: 'y' }] })).toHaveLength(1);
  });

  it('maps alternate field names and defaults risk to high', () => {
    const out = normalizeApprovals([{ id: 'z', tool: 'http' }]);
    expect(out[0].toolName).toBe('http');
    expect(out[0].riskLevel).toBe('high');
  });

  it('drops entries without an id and ignores junk', () => {
    expect(normalizeApprovals([{ toolName: 'x' }, null, 'str'])).toHaveLength(0);
    expect(normalizeApprovals(undefined)).toEqual([]);
  });
});

describe('formatArgs', () => {
  it('pretty-prints objects', () => {
    expect(formatArgs({ a: 1 })).toContain('"a": 1');
  });
  it('handles cyclic input gracefully', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(typeof formatArgs(o)).toBe('string');
  });
});

describe('parseEditedArgs', () => {
  it('parses a JSON object', () => {
    const r = parseEditedArgs('{"x": 2}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ x: 2 });
  });
  it('treats empty input as empty object', () => {
    const r = parseEditedArgs('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({});
  });
  it('rejects arrays and primitives', () => {
    expect(parseEditedArgs('[1,2]').ok).toBe(false);
    expect(parseEditedArgs('42').ok).toBe(false);
  });
  it('rejects invalid JSON', () => {
    expect(parseEditedArgs('{bad').ok).toBe(false);
  });
});

describe('riskBadgeVariant', () => {
  it('maps known levels', () => {
    expect(riskBadgeVariant('low')).toBe('success');
    expect(riskBadgeVariant('critical')).toBe('danger');
  });
  it('falls back to default', () => {
    expect(riskBadgeVariant(undefined)).toBe('default');
  });
});
