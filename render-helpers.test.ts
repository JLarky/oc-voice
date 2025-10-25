import { describe, test, expect } from 'bun:test';
import { renderSessionsUl, renderIpsUl, renderMessageItems } from './render-helpers';
import { escapeHtml } from './render';

// Inline snapshot coverage focuses on complete HTML output
// ensuring structure + escaping remain stable.

describe('renderSessionsUl', () => {
  test('empty sessions yields empty li', () => {
    const html = renderSessionsUl('127.0.0.1', []);
    expect(html).toContain('(no sessions)');
    expect(html).toMatchInlineSnapshot(`"<ul id=\"sessions-ul\"><li class=\"empty\">(no sessions)</li></ul>"`);
  });
  test('renders session entries with delete button', () => {
    const html = renderSessionsUl('127.0.0.1', [{ id: 'abc', title: 'Title' }]);
    expect(html).toContain('abc');
    expect(html).toContain('delete-session');
    expect(html).toMatchInlineSnapshot(`"<ul id=\"sessions-ul\"><li><a href=\"/sessions/127.0.0.1/abc\"><span class=\"id\">abc</span></a> - Title <button style=\"background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px\" data-on:click=\"@post('/sessions/127.0.0.1/abc/delete-session')\">✕</button></li></ul>"`);
  });
});

describe('renderIpsUl', () => {
  test('empty IP list yields empty li', () => {
    const html = renderIpsUl([]);
    expect(html).toContain('(no addresses)');
    expect(html).toMatchInlineSnapshot(`"<ul id=\"ips-ul\"><li class=\"empty\">(no addresses)</li></ul>"`);
  });
  test('renders IP entries with remove button', () => {
    const html = renderIpsUl(['10.0.0.1']);
    expect(html).toContain('10.0.0.1');
    expect(html).toContain('ips/remove/10.0.0.1');
    expect(html).toMatchInlineSnapshot(`"<ul id=\"ips-ul\"><li><a href=\"/sessions/10.0.0.1\"><span class=\"ip\">10.0.0.1</span></a> <button data-on:click=\"@post('/ips/remove/10.0.0.1')\" class=\"remove-btn\">✕</button></li></ul>"`);
  });
});

describe('renderMessageItems', () => {
  test('empty messages yields empty div', () => {
    const html = renderMessageItems([]);
    expect(html).toContain('(no messages)');
    expect(html).toMatchInlineSnapshot(`"<div class=\"empty\">(no messages)</div>"`);
  });
  test('renders role and text escaped', () => {
    const html = renderMessageItems([{ role: 'user', parts: [{ type: 'text', text: '<script>' }] }]);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toMatchInlineSnapshot(`"<div class=\"message\"><div class=\"message-role\">user</div><div class=\"message-text\">&lt;script&gt;</div></div>"`);
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
