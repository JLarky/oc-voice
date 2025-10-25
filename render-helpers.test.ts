import { describe, test, expect } from 'bun:test';
import { renderSessionsUl, renderIpsUl, renderMessageItems } from './render-helpers';
import { escapeHtml } from './render';

describe('renderSessionsUl', () => {
  test('empty sessions yields empty li', () => {
    const html = renderSessionsUl('127.0.0.1', []);
    expect(html).toContain('(no sessions)');
    expect(html).toContain('id="sessions-ul"');
  });
  test('renders session entries with delete button', () => {
    const html = renderSessionsUl('127.0.0.1', [{ id: 'abc', title: 'Title' }]);
    expect(html).toContain('abc');
    expect(html).toContain('delete-session');
  });
});

describe('renderIpsUl', () => {
  test('empty IP list yields empty li', () => {
    const html = renderIpsUl([]);
    expect(html).toContain('(no addresses)');
    expect(html).toContain('id="ips-ul"');
  });
  test('renders IP entries with remove button', () => {
    const html = renderIpsUl(['10.0.0.1']);
    expect(html).toContain('10.0.0.1');
    expect(html).toContain('ips/remove/10.0.0.1');
  });
});

describe('renderMessageItems', () => {
  test('empty messages yields empty div', () => {
    const html = renderMessageItems([]);
    expect(html).toContain('(no messages)');
  });
  test('renders role and text escaped', () => {
    const html = renderMessageItems([{ role: 'user', parts: [{ type: 'text', text: '<script>' }] }]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('escapeHtml', () => {
  test('escapes special characters', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
  });
  test('returns input when no specials', () => {
    expect(escapeHtml('plain')).toBe('plain');
  });
});
