import { describe, test, expect } from 'bun:test';
import { h } from 'preact';
import { render } from 'preact-render-to-string';
import { MessagesList } from './fragments';

const msgs = [
  { role: 'user', text: 'Hello <world>' },
  { role: 'assistant', parts: [{ type: 'text', text: 'Reply & details' }] }
];

describe('MessagesList component', () => {
  test('renders messages with escaping and summary info badge', () => {
    const html = render(<MessagesList messages={msgs as any} summaryText={'Summary <unsafe> & text'} actionFlag={false} totalCount={msgs.length} />);
    expect(html).toContain('messages-list');
    expect(html).toContain('Hello &lt;world>');
    expect(html).toContain('Reply &amp; details');
    expect(html).toContain('summary: Summary &lt;unsafe> &amp; text');
    expect(html).toContain('>info<');
  });
  test('renders action badge when actionFlag true', () => {
    const html = render(<MessagesList messages={msgs as any} summaryText={'x'} actionFlag={true} totalCount={msgs.length} />);
    expect(html).toContain('>action<');
  });
  test('empty messages shows (no messages)', () => {
    const html = render(<MessagesList messages={[]} summaryText={'none'} actionFlag={false} totalCount={0} />);
    expect(html).toContain('(no messages)');
    expect(html).not.toContain('messages-summary');
  });
});
