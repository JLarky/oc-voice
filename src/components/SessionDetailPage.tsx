import { Layout } from "./Layout";

export interface SessionDetailProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}

export function SessionDetailPage(props: SessionDetailProps) {
  const title = props.sessionTitle || props.sessionId || "Session";
  return (
    <Layout title={`Session ${title}`} needsDatastar={true} needsClient={true}>
      <h1>{title}</h1>
      <div>
        <a href={`/sessions/${props.ip}`}>← Back to sessions for {props.ip}</a>
      </div>
      <speech-button>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
          <a href={`/sessions/${props.ip}/${props.sessionId}/advanced`}>
            <button type="button">Advanced</button>
          </a>
          <button type="button">Read Summary</button>
          <button type="button">Play</button>
          <button type="button">Test</button>
        </div>
      </speech-button>
      <h2>Messages</h2>
      <div id="messages-status" className="status">
        Connecting...
      </div>
      <messages-wrapper>
        <div id="messages-list-container">
          <div
            id="messages-list"
            data-init={`@get('/sessions/${props.ip}/${props.sessionId}/messages/stream')`}
          >
            <div>(loading unified messages)</div>
          </div>
        </div>
      </messages-wrapper>
      <h2>Send Message</h2>
      <form
        id="session-message-form"
        data-on:submit={`@post('/sessions/${props.ip}/${props.sessionId}/message'); $messagetext = ''`}
      >
        <div className="row">
          <submit-on-enter style={{ display: "contents" }}>
            <textarea
              id="session-message-input"
              data-bind:messagetext=""
              name="messageText"
              placeholder="Enter message"
              rows={4}
              style={{ flex: 1, resize: "vertical" }}
              defaultValue={""}
            />
          </submit-on-enter>
          <button type="submit">Send</button>
        </div>
        <div id="session-message-result" className="result"></div>
      </form>
    </Layout>
  );
}
