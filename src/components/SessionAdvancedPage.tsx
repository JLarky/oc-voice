import { Layout } from "./Layout";

export interface SessionAdvancedProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}

export function SessionAdvancedPage(props: SessionAdvancedProps) {
  const title = props.sessionTitle || props.sessionId || "Session";
  return (
    <Layout
      title={`Advanced ${title}`}
      needsDatastar={true}
      needsClient={false}
    >
      <h1>Advanced View</h1>
      <div>
        <a href={`/sessions/${props.ip}/${props.sessionId}`}>
          ← Back to session
        </a>
      </div>
      <div style={{ margin: ".5rem 0" }}>
        <button
          style={{
            background: "#e74c3c",
            color: "#fff",
            marginRight: ".5rem",
            padding: ".25rem .5rem",
            fontSize: ".7rem",
            border: "none",
            borderRadius: "3px",
            cursor: "pointer",
          }}
          data-on:click={`@post('/sessions/${props.ip}/${props.sessionId}/delete-session')`}
        >
          Delete Session
        </button>
        <span style={{ fontSize: ".7rem", color: "#555" }}>
          (redirects to list on success)
        </span>
      </div>
      <div id="delete-session-result" className="result" />
      <div id="advanced-status" className="status">
        Connecting...
      </div>
      <div
        id="advanced-info"
        data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/stream')`}
      >
        <div>(loading)</div>
      </div>

      <h2>Events (Raw SSE)</h2>
      <div
        id="advanced-events"
        data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/events/stream')`}
      >
        <div id="advanced-events-inner">
          <div>(connecting events)</div>
        </div>
      </div>
      <h2>SDK Session JSON</h2>
      <div
        id="advanced-sdk-json-container"
        data-init={`@get('/sessions/${props.ip}/${props.sessionId}/advanced/sdk-json')`}
      >
        <div>(loading SDK JSON)</div>
      </div>
    </Layout>
  );
}
