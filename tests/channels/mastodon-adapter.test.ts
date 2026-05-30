import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MastodonAdapter,
  stripHtml,
  type MastodonInboundMessage,
} from '../../channels/mastodon/src/adapter.js';

/** Build a Response-like object the adapter's fetch helper understands. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

const ACCOUNT = { id: '1', acct: 'me@inst' };

describe('stripHtml (#610)', () => {
  it('removes tags and decodes entities', () => {
    expect(stripHtml('<p>hello <b>world</b> &amp; more</p>')).toBe(
      'hello world & more',
    );
  });

  it('turns <br> and paragraph breaks into newlines', () => {
    expect(stripHtml('<p>a</p><p>b</p>')).toBe('a\n\nb');
    expect(stripHtml('a<br>b')).toBe('a\nb');
  });
});

describe('MastodonAdapter construction (#610)', () => {
  it('requires instanceUrl and accessToken', () => {
    expect(() => new MastodonAdapter({ instanceUrl: '', accessToken: 't' })).toThrow();
    expect(
      () => new MastodonAdapter({ instanceUrl: 'https://x', accessToken: '' }),
    ).toThrow();
  });

  it('normalizes trailing slashes on the instance URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(ACCOUNT));
    const a = new MastodonAdapter({
      instanceUrl: 'https://inst.social/',
      accessToken: 'tok',
      fetchFn,
    });
    await a.verifyCredentials();
    expect(fetchFn).toHaveBeenCalledWith(
      'https://inst.social/api/v1/accounts/verify_credentials',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
  });
});

describe('MastodonAdapter.send (#610)', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let adapter: MastodonAdapter;

  beforeEach(() => {
    fetchFn = vi.fn();
    adapter = new MastodonAdapter({
      instanceUrl: 'https://inst.social',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
  });

  it('posts a status and returns its id', async () => {
    fetchFn.mockResolvedValue(jsonResponse({ id: '999' }));
    const id = await adapter.send({ text: 'hello fediverse' });
    expect(id).toBe('999');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://inst.social/api/v1/statuses');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.status).toBe('hello fediverse');
    expect(body.visibility).toBe('public');
  });

  it('degrades long markdown to plain text within 500 chars', async () => {
    fetchFn.mockResolvedValue(jsonResponse({ id: '1' }));
    const long = '**bold** `code` ' + 'x'.repeat(600);
    await adapter.send({ text: long });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.status).not.toContain('**');
    expect(body.status).not.toContain('`');
    expect(body.status.length).toBeLessThanOrEqual(500);
  });

  it('replies use unlisted visibility and preserve in_reply_to_id', async () => {
    fetchFn.mockResolvedValue(jsonResponse({ id: '2' }));
    await adapter.send({ text: 'reply', inReplyToId: 'parent' });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.in_reply_to_id).toBe('parent');
    expect(body.visibility).toBe('unlisted');
  });

  it('reply() to a DM uses direct visibility', async () => {
    fetchFn.mockResolvedValue(jsonResponse({ id: '3' }));
    const inbound: MastodonInboundMessage = {
      channel: 'mastodon',
      id: 'n1',
      kind: 'direct',
      from: 'alice@inst',
      text: 'hi',
      inReplyToId: 's1',
      conversationId: 'c1',
      raw: {},
    };
    await adapter.reply(inbound, 'hey back');
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.visibility).toBe('direct');
    expect(body.in_reply_to_id).toBe('s1');
  });

  it('throws on non-2xx API responses', async () => {
    fetchFn.mockResolvedValue(jsonResponse({ error: 'bad' }, 422));
    await expect(adapter.send({ text: 'x' })).rejects.toThrow(/422/);
  });
});

describe('MastodonAdapter inbound polling (#610)', () => {
  function makeAdapter(fetchFn: ReturnType<typeof vi.fn>) {
    return new MastodonAdapter({
      instanceUrl: 'https://inst.social',
      accessToken: 'tok',
      fetchFn: fetchFn as unknown as typeof fetch,
      pollIntervalMs: 999999, // avoid auto re-poll during the test
    });
  }

  function route(url: string) {
    if (url.includes('verify_credentials')) return jsonResponse(ACCOUNT);
    if (url.includes('/api/v1/conversations')) return jsonResponse([]);
    if (url.includes('/api/v1/notifications')) return jsonResponse([]);
    return jsonResponse([]);
  }

  it('dispatches public mentions to the handler', async () => {
    const mention = {
      id: 'n10',
      type: 'mention',
      account: { id: '5', acct: 'bob@inst' },
      status: {
        id: 's10',
        content: '<p>hey <b>karna</b></p>',
        account: { id: '5', acct: 'bob@inst' },
        visibility: 'unlisted',
      },
    };
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/api/v1/notifications')) return jsonResponse([mention]);
      return route(url);
    });
    const adapter = makeAdapter(fetchFn);
    const received: MastodonInboundMessage[] = [];
    adapter.onMessage((m) => {
      received.push(m);
    });
    await adapter.start();

    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('mention');
    expect(received[0].from).toBe('bob@inst');
    expect(received[0].text).toBe('hey karna');
    expect(received[0].inReplyToId).toBe('s10');
    await adapter.stop();
  });

  it('skips direct-visibility mentions (handled as conversations)', async () => {
    const directMention = {
      id: 'n11',
      type: 'mention',
      account: { id: '5', acct: 'bob@inst' },
      status: {
        id: 's11',
        content: '<p>dm</p>',
        account: { id: '5', acct: 'bob@inst' },
        visibility: 'direct',
      },
    };
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/api/v1/notifications')) return jsonResponse([directMention]);
      return route(url);
    });
    const adapter = makeAdapter(fetchFn);
    const received: MastodonInboundMessage[] = [];
    adapter.onMessage((m) => received.push(m));
    await adapter.start();
    expect(received).toHaveLength(0);
    await adapter.stop();
  });

  it('does not dispatch the same mention twice across polls', async () => {
    const mention = {
      id: 'n12',
      type: 'mention',
      account: { id: '5', acct: 'bob@inst' },
      status: {
        id: 's12',
        content: '<p>hi</p>',
        account: { id: '5', acct: 'bob@inst' },
        visibility: 'public',
      },
    };
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('/api/v1/notifications')) return jsonResponse([mention]);
      return route(url);
    });
    const adapter = makeAdapter(fetchFn);
    const received: MastodonInboundMessage[] = [];
    adapter.onMessage((m) => received.push(m));
    await adapter.start(); // primes + first poll
    await adapter.poll(); // manual second poll
    expect(received).toHaveLength(1);
    await adapter.stop();
  });

  it('dispatches new DM conversations after the priming poll', async () => {
    let convCall = 0;
    const conv = (statusId: string) => ({
      id: 'c1',
      last_status: {
        id: statusId,
        content: '<p>secret</p>',
        account: { id: '7', acct: 'carol@inst' },
        visibility: 'direct',
      },
    });
    const fetchFn = vi.fn((url: string) => {
      if (url.includes('verify_credentials')) return jsonResponse(ACCOUNT);
      if (url.includes('/api/v1/notifications')) return jsonResponse([]);
      if (url.includes('/api/v1/conversations')) {
        convCall++;
        // first (priming) returns initial status; second returns a NEW status
        return jsonResponse([conv(convCall === 1 ? 's-init' : 's-new')]);
      }
      return jsonResponse([]);
    });
    const adapter = makeAdapter(fetchFn);
    const received: MastodonInboundMessage[] = [];
    adapter.onMessage((m) => received.push(m));
    await adapter.start(); // priming poll: records cursor, no dispatch
    expect(received).toHaveLength(0);
    await adapter.poll(); // new DM => dispatched
    expect(received).toHaveLength(1);
    expect(received[0].kind).toBe('direct');
    expect(received[0].conversationId).toBe('c1');
    expect(received[0].text).toBe('secret');
    await adapter.stop();
  });

  it('isRunning reflects start/stop', async () => {
    const fetchFn = vi.fn((url: string) => route(url));
    const adapter = makeAdapter(fetchFn);
    expect(adapter.isRunning()).toBe(false);
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });
});
