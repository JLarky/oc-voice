import { describe, test, expect } from "bun:test";
import { h } from "preact";
import { render } from "preact-render-to-string";
import {
  SessionsUl,
  IpsUl,
  renderSessionDetailPage,
  renderSessionsListPage,
} from "./rendering";

// Inline snapshot coverage focuses on small fragment helpers.
// Page renderers are large; we assert key structural markers instead of full snapshots.

describe("SessionsUl component", () => {
  test("empty sessions yields empty li", () => {
    const html = render(
      <SessionsUl ip="127.0.0.1" sessions={[]} summarizerId={undefined} />,
    );
    expect(html).toContain("(no sessions)");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"sessions-ul\"><li class=\"empty\">(no sessions)</li></ul>"`,
    );
  });
  test("renders session entries with delete button", () => {
    const html = render(
      <SessionsUl
        ip="127.0.0.1"
        sessions={[{ id: "abc", title: "Title" }]}
        summarizerId={undefined}
      />,
    );
    expect(html).toContain("abc");
    expect(html).toContain("delete-session");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"sessions-ul\"><li><a href=\"/sessions/127.0.0.1/abc\"><span class=\"id\">abc</span></a> - Title <button style=\"background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px\" data-on:click=\"@post('/sessions/127.0.0.1/abc/delete-session')\">✕</button></li></ul>"`,
    );
  });
  test("applies opacity when summarizerId matches", () => {
    const html = render(
      <SessionsUl
        ip="127.0.0.1"
        sessions={[{ id: "summ123", title: "Discussion thread" }]}
        summarizerId={"summ123"}
      />,
    );
    expect(html).toContain('<li style="opacity:.5">');
  });
  test("does not apply opacity when summarizerId mismatch even if title contains summary", () => {
    const html = render(
      <SessionsUl
        ip="127.0.0.1"
        sessions={[{ id: "other", title: "Conversation Summary" }]}
        summarizerId={"summ123"}
      />,
    );
    expect(html).not.toContain("opacity:.5");
  });
});

describe("IpsUl component", () => {
  test("empty IP list yields empty li", () => {
    const html = render(<IpsUl ips={[]} />);
    expect(html).toContain("(no addresses)");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"ips-ul\"><li class=\"empty\">(no addresses)</li></ul>"`,
    );
  });
  test("renders IP entries with remove button", () => {
    const html = render(<IpsUl ips={["10.0.0.1"]} />);
    expect(html).toContain("10.0.0.1");
    expect(html).toContain("ips/remove/10.0.0.1");
    expect(html).toMatchInlineSnapshot(
      `"<ul id=\"ips-ul\"><li><a href=\"/sessions/10.0.0.1\"><span class=\"ip\">10.0.0.1</span></a> <button data-on:click=\"@post('/ips/remove/10.0.0.1')\" class=\"remove-btn\">✕</button></li></ul>"`,
    );
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
    expect(html).toContain("@get('/sessions/1.2.3.4/sess123/effect/stream')");
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
