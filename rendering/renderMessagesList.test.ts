import { describe, test, expect } from 'bun:test';
import { renderMessagesList } from './fragments';

const msgs = [
  { role: 'user', text: 'Hello <world>' },
  { role: 'assistant', parts: [{ type: 'text', text: 'Reply & details' }] }
];

describe('renderMessagesList', () => {
  test('renders messages with escaping and summary info badge', () => {
    const html = renderMessagesList(msgs as any, 'Summary <unsafe> & text', false, msgs.length);
    expect(html).toContain('messages-list');
    // Preact auto-escapes angle brackets
    expect(html).toContain('Hello &lt;world>');
    expect(html).toContain('Reply &amp; details');
    // Summary escaped
    expect(html).toContain('summary: Summary &lt;unsafe> &amp; text');
    // Info badge
    expect(html).toContain('>info<');
  });
  test('renders action badge when actionFlag true', () => {
    const html = renderMessagesList(msgs as any, 'x', true, msgs.length);
    expect(html).toContain('>action<');
  });
  test('empty messages shows (no messages)', () => {
    const html = renderMessagesList([], 'none', false, 0);
    expect(html).toContain('(no messages)');
    // No summary div since totalCount is 0
    expect(html).not.toContain('messages-summary');
  });
});
