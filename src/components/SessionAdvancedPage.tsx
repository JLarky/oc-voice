import { Layout } from './Layout';

export interface SessionAdvancedProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}

export function SessionAdvancedPage(props: SessionAdvancedProps) {
  const title = props.sessionTitle || props.sessionId || 'Session';
  return (
    <Layout title={`Advanced ${title}`} needsDatastar={true} needsClient={false}>
      <h1>Advanced View</h1>
      <div>
        <a href={`/sessions/${props.ip}/${props.sessionId}`}>← Back to session</a>
      </div>
      <div id="advanced-status" className="status">Connecting...</div>
      <div id="advanced-info" data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/stream')`}>
        <div>(loading)</div>
      </div>
      <h2>Events (Raw SSE)</h2>
      <div id="advanced-events" data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/events/stream')`}>
        <div>(connecting events)</div>
      </div>
      <h2>SDK Session JSON</h2>
      <div id="advanced-sdk-json-container" data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/sdk-json')`}>
        <div>(loading SDK JSON)</div>
      </div>
    </Layout>
  );
}
