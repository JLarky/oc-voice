// session-detail.ts - session detail page HTML
import { render } from "preact-render-to-string";
import { SessionDetailPage } from "../src/components/SessionDetailPage";
export interface SessionDetailProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}
export function renderSessionDetailPage({
  ip,
  sessionId,
  sessionTitle,
}: SessionDetailProps): string {
  return '<!doctype html>' + render(
    <SessionDetailPage
      ip={ip}
      sessionId={sessionId}
      sessionTitle={sessionTitle}
    />,
  );
}
