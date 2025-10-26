// session-advanced.ts - advanced session page HTML
import { render } from 'preact-render-to-string';
import { SessionAdvancedPage } from '../src/components/SessionAdvancedPage';

export interface SessionAdvancedProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}

export function renderSessionAdvancedPage({ ip, sessionId, sessionTitle }: SessionAdvancedProps): string {
  return '<!doctype html>' + render(
    <SessionAdvancedPage ip={ip} sessionId={sessionId} sessionTitle={sessionTitle} />,
  );
}
