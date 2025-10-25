// sessions-list.ts - sessions list page HTML (JSX version)
import { render } from 'preact-render-to-string';
import { SessionsListPage } from '../src/components/SessionsListPage';

export interface SessionsListProps {
  ip: string;
}

export function renderSessionsListPage({ ip }: SessionsListProps): string {
  // Upstream validates ip; rely on Preact escaping for any dynamic text.
  return '<!doctype html>' + render(<SessionsListPage ip={ip} />);
}
