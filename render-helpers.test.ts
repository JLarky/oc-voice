import { describe, test, expect } from "bun:test";
import {
  renderSessionsUl,
  renderIpsUl,
  renderMessageItems,
  escapeHtml,
  renderSessionDetailPage,
  renderSessionsListPage,
} from "./rendering";

// Inline snapshot coverage focuses on small fragment helpers.
// Page renderers are large; we assert key structural markers instead of full snapshots.

describe("renderSessionsUl", () => {
  test("empty sessions yields empty li", () => {
    const html = renderSessionsUl("127.0.0.1", [], undefined);
    expect(html).toContain("(no sessions)");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"sessions-ul\"><li class=\"empty\">(no sessions)</li></ul>"`,
    );
  });
  test("renders session entries with delete button", () => {
    const html = renderSessionsUl("127.0.0.1", [{ id: "abc", title: "Title" }], undefined);
    expect(html).toContain("abc");
    expect(html).toContain("delete-session");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"sessions-ul\"><li><a href=\"/sessions/127.0.0.1/abc\"><span class=\"id\">abc</span></a> - Title <button style=\"background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px\" data-on:click=\"@post('/sessions/127.0.0.1/abc/delete-session')\">✕</button></li></ul>"`,
    );
  });
  test("applies opacity when summarizerId matches", () => {
    const html = renderSessionsUl("127.0.0.1", [{ id: "summ123", title: "Discussion thread" }], "summ123");
    expect(html).toContain("<li style=\"opacity:.5\">");
  });
  test("does not apply opacity when summarizerId mismatch even if title contains summary", () => {
    const html = renderSessionsUl("127.0.0.1", [{ id: "other", title: "Conversation Summary" }], "summ123");
    expect(html).not.toContain("opacity:.5");
  });
});

describe("renderIpsUl", () => {
  test("empty IP list yields empty li", () => {
    const html = renderIpsUl([]);
    expect(html).toContain("(no addresses)");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"ips-ul\"><li class=\"empty\">(no addresses)</li></ul>"`,
    );
  });
  test("renders IP entries with remove button", () => {
    const html = renderIpsUl(["10.0.0.1"]);
    expect(html).toContain("10.0.0.1");
    expect(html).toContain("ips/remove/10.0.0.1");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"ips-ul\"><li><a href=\"/sessions/10.0.0.1\"><span class=\"ip\">10.0.0.1</span></a> <button data-on:click=\"@post('/ips/remove/10.0.0.1')\" class=\"remove-btn\">✕</button></li></ul>"`,
    );
  });
});

describe("renderMessageItems", () => {
  test("empty messages yields empty div", () => {
    const html = renderMessageItems([]);
    expect(html).toContain("(no messages)");
    expect(html).toMatchInlineSnapshot(
      `"<div class=\"empty\">(no messages)</div>"`,
    );
  });
  test("renders role and text escaped", () => {
    const html = renderMessageItems([
      { role: "user", parts: [{ type: "text", text: "<script>" }] },
    ]);
    // Preact escapes '<' but not necessarily closing '>' after text nodes; we only ensure opening tag is escaped and raw <script> not present.
    expect(html).toContain("&lt;script");
    expect(html).not.toContain("<script>");
  });
});

describe("renderSessionDetailPage", () => {
  test("renders escaped title and key sections", () => {
    const html = renderSessionDetailPage({
      ip: "1.2.3.4",
      sessionId: "sess123",
      sessionTitle: "<bad>",
    });
    expect(html).toContain("&lt;bad");
    expect(html).not.toContain("<bad>");
    expect(html).toContain("@get('/sessions/1.2.3.4/sess123/messages/stream')");
    expect(html).toContain("@get('/sessions/1.2.3.4/sess123/messages/stream')");
    expect(
      html.startsWith(
        '<!doctype html><html lang="en"><head><meta charset="UTF-8"/>',
      ),
    ).toBe(true);
  });
});

describe("renderSessionsListPage", () => {
  test("renders escaped ip and actions", () => {
    const html = renderSessionsListPage({ ip: "5.6.7.8" });
    expect(html).toContain("Sessions for 5.6.7.8");
    expect(html).toContain("@post('/sessions/5.6.7.8/clear-sessions')");
    expect(html).toContain("/sessions/5.6.7.8/create-session");
    expect(
      html.startsWith(
        '<!doctype html><html lang="en"><head><meta charset="UTF-8"/>',
      ),
    ).toBe(true);
  });
});

describe("escapeHtml", () => {
  test("escapes special characters", () => {
    expect(escapeHtml('&<>"')).toBe("&amp;&lt;&gt;&quot;");
  });
  test("returns input when no specials", () => {
    expect(escapeHtml("plain")).toBe("plain");
  });
});
