import { describe, it, expect } from 'vitest';
import {
  CHANNEL_CAPABILITIES,
  DEFAULT_CAPABILITIES,
  degradeAndSplit,
  degradeOutput,
  downgradeToBasicMarkdown,
  getCapabilities,
  isCapabilityMatrixComplete,
  stripMarkdown,
  truncate,
  type ChannelCapabilities,
} from '../../channels/_shared/capabilities.js';

describe('capability matrix (#606)', () => {
  it('has a complete, well-formed descriptor for every channel', () => {
    expect(isCapabilityMatrixComplete()).toBe(true);
    for (const caps of Object.values(CHANNEL_CAPABILITIES)) {
      expect(caps.maxMessageLength).toBeGreaterThan(0);
    }
  });

  it('includes the new mastodon channel with a 500 char plain-text limit', () => {
    const m = CHANNEL_CAPABILITIES.mastodon;
    expect(m.maxMessageLength).toBe(500);
    expect(m.markdown).toBe('none');
  });

  it('getCapabilities returns the descriptor for known channels', () => {
    expect(getCapabilities('slack')).toBe(CHANNEL_CAPABILITIES.slack);
  });

  it('getCapabilities falls back to safe defaults for unknown channels', () => {
    expect(getCapabilities('does-not-exist')).toEqual(DEFAULT_CAPABILITIES);
  });
});

describe('stripMarkdown', () => {
  it('strips bold, italic and inline code', () => {
    expect(stripMarkdown('**bold** and *italic* and `code`')).toBe(
      'bold and italic and code',
    );
  });

  it('keeps fenced code content but removes the fences', () => {
    expect(stripMarkdown('before\n```js\nconst x = 1;\n```\nafter')).toContain(
      'const x = 1;',
    );
    expect(stripMarkdown('```\nx\n```')).not.toContain('```');
  });

  it('converts links to text (url)', () => {
    expect(stripMarkdown('see [docs](https://x.dev)')).toBe(
      'see docs (https://x.dev)',
    );
  });

  it('removes heading, blockquote and list markers', () => {
    expect(stripMarkdown('# Title')).toBe('Title');
    expect(stripMarkdown('> quote')).toBe('quote');
    expect(stripMarkdown('- item')).toBe('item');
  });
});

describe('downgradeToBasicMarkdown', () => {
  it('preserves emphasis but removes code/links/headings', () => {
    const out = downgradeToBasicMarkdown('# H\n**keep** `drop` [t](u)');
    expect(out).toContain('**keep**');
    expect(out).not.toContain('`');
    expect(out).not.toContain('# ');
    expect(out).toContain('t (u)');
  });
});

describe('truncate', () => {
  it('does not modify text within the limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and appends a marker within budget', () => {
    const out = truncate('abcdefghij', 5);
    expect(out.length).toBe(5);
    expect(out.endsWith('…')).toBe(true);
  });

  it('treats Infinity as no limit', () => {
    expect(truncate('x'.repeat(1000), Infinity)).toHaveLength(1000);
  });
});

describe('degradeOutput', () => {
  const plain: ChannelCapabilities = {
    buttons: false,
    attachments: false,
    threads: false,
    reactions: false,
    maxMessageLength: 20,
    markdown: 'none',
  };

  it('strips markdown and enforces length for plain channels', () => {
    const out = degradeOutput('**hello world** this is long text', plain);
    expect(out).not.toContain('**');
    expect(out.length).toBeLessThanOrEqual(20);
  });

  it('respects markdown=full by leaving syntax intact', () => {
    const out = degradeOutput('**bold**', CHANNEL_CAPABILITIES.slack);
    expect(out).toBe('**bold**');
  });

  it('degrades for mastodon (plain text, <=500 chars)', () => {
    const long = '`code` ' + 'x'.repeat(600);
    const out = degradeOutput(long, getCapabilities('mastodon'));
    expect(out).not.toContain('`');
    expect(out.length).toBeLessThanOrEqual(500);
  });
});

describe('degradeAndSplit', () => {
  it('returns a single chunk when within limit', () => {
    expect(degradeAndSplit('short', getCapabilities('mastodon'))).toEqual([
      'short',
    ]);
  });

  it('splits long text into channel-sized chunks on boundaries', () => {
    const caps: ChannelCapabilities = { ...DEFAULT_CAPABILITIES, maxMessageLength: 10 };
    const chunks = degradeAndSplit('aaaa bbbb cccc dddd', caps);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toContain('dddd');
  });
});
