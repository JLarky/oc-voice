import { summarizeMessages } from './oc-client';

// Minimal mock utilities
function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: any }>) {
  let call = 0;
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const idx = call++;
    const spec = responses[idx];
    if (!spec) throw new Error('Unexpected fetch call ' + idx + ' ' + url);
    return {
      ok: spec.ok,
      status: spec.status ?? (spec.ok ? 200 : 500),
      async json() { return spec.json; },
    } as any;
  };
}

// Mock Bun.file + Bun.write for ensureSummarizer path
// @ts-ignore
Bun.file = (path: string) => ({ text: async () => { throw new Error('no file'); } });
// @ts-ignore
Bun.write = async (path: string, data: string) => { /* noop */ };

describe('summarizeMessages', () => {
  it('parses action=yes flag', async () => {
    mockFetchSequence([
      // listSessions contains existing summarizer
      { ok: true, json: [{ id: 'sess-1', title: 'summarizer' }] },
      // single send (combined + prompt) returns summary line
      { ok: true, json: { parts: [{ type: 'text', text: 'User wants help |action=yes' }] } },
    ]);
    const recent = [ { role: 'user', text: 'How do I deploy?' } ];
    const res = await summarizeMessages('http://127.0.0.1:2000', recent, 'sess-xyz');
    expect(res.ok).toBe(true);
    expect(res.action).toBe(true);
    expect(res.summary).toContain('|action=yes');
  });

  it('parses action=no flag', async () => {
    mockFetchSequence([
      // listSessions empty triggers create
      { ok: true, json: [] },
      // create summarizer session
      { ok: true, json: { id: 'sess-2' } },
      // single send (combined + prompt) returns summary line
      { ok: true, json: { parts: [{ type: 'text', text: 'General info only |action=no' }] } },
    ]);
    const recent = [ { role: 'assistant', text: 'Sure.' }, { role: 'user', text: 'Thanks.' } ];
    const res = await summarizeMessages('http://127.0.0.1:2000', recent, 'sess-xyz');
    expect(res.ok).toBe(true);
    expect(res.action).toBe(false);
    expect(res.summary).toContain('|action=no');
  });

  it('handles failure when no summarizer session returned', async () => {
    mockFetchSequence([
      // listSessions returns bad shape
      { ok: true, json: { unexpected: true } },
      // attempt create fails
      { ok: false, status: 500, json: { error: 'fail' } },
    ]);
    const res = await summarizeMessages('http://127.0.0.1:2000', [ { role: 'user', text: 'Ping' } ], 'sess-xyz');
    expect(res.ok).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.action).toBe(false);
  });
  it('returns cannot summarize when target equals summarizer session', async () => {
    mockFetchSequence([
      { ok: true, json: [{ id: 'sess-guard', title: 'summarizer' }] },
    ]);
    const recent = [ { role: 'user', text: 'Hello there' } ];
    const res = await summarizeMessages('http://127.0.0.1:2000', recent, 'sess-guard');
    expect(res.ok).toBe(true);
    expect(res.summary).toBe("can't summarize");
    expect(res.action).toBe(false);
  });
});
