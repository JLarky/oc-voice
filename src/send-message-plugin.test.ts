import { describe, it, expect } from 'bun:test';
import { Elysia } from 'elysia';
import { sendMessagePlugin } from './modules/sessions/send-message';
import { addIp } from './utils/store-ips';
import { FIRST_MESSAGE_INSTRUCTION } from './oc-client';

function mockFetchSequence(
  responses: Array<{ ok: boolean; status?: number; json?: any }>,
  bodies: string[] = [],
) {
  let call = 0;
  // @ts-ignore
  global.fetch = async (url: string, opts?: any) => {
    const idx = call++;
    const spec = responses[idx];
    if (!spec) throw new Error('Unexpected fetch call ' + idx + ' ' + url);
    if (opts && opts.body) bodies.push(String(opts.body));
    return {
      ok: spec.ok,
      status: spec.status ?? (spec.ok ? 200 : 500),
      async json() {
        return spec.json;
      },
    } as any;
  };
  return bodies;
}

describe('sendMessagePlugin', () => {
  it('injects first message instruction and returns SSE patch', async () => {
    addIp('127.0.0.1');
    const bodies: string[] = [];
    mockFetchSequence([
      { ok: true, json: [] }, // listMessages => empty triggers injection
      { ok: true, json: { parts: [{ type: 'text', text: 'Assistant reply here' }] } },
    ], bodies);
    const app = new Elysia().use(sendMessagePlugin);
    const req = new Request('http://localhost/sessions/127.0.0.1/sess-abc/message', {
      method: 'POST',
      body: JSON.stringify({ text: 'Hello world' }),
    });
    const res = await app.handle(req);
    const txt = await res.text();
    expect(txt.includes('event: datastar-patch-elements')).toBe(true);
    expect(txt.includes('Reply:')).toBe(true);
    // Check that POST body had injection
    const postBody = bodies.find((b) => b.includes('/session/')); // not reliable path marker
    // Bodies captured are raw JSON payloads; second call is the POST
    const second = bodies[bodies.length - 1];
    const parsed = JSON.parse(second);
    const sentText = parsed.parts[0].text as string;
    expect(sentText.startsWith(FIRST_MESSAGE_INSTRUCTION)).toBe(true);
  });
});
