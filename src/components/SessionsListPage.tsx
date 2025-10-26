import { Layout } from "./Layout";

export interface SessionsListProps {
  ip: string;
}

export function SessionsListPage({ ip }: SessionsListProps) {
  return (
    <Layout title={`Sessions for ${ip}`} needsDatastar={true}>
      <h1>Sessions for {ip}</h1>
      <div>
        <a href="/">← Back home</a>
      </div>
      <h2>Sessions</h2>
      <button
        style={{
          background: "#e74c3c",
          color: "#fff",
          marginBottom: ".5rem",
          padding: ".25rem .5rem",
          fontSize: ".7rem",
          border: "none",
          borderRadius: "3px",
          cursor: "pointer",
        }}
        data-on:click={`@post('/sessions/${ip}/clear-sessions')`}
      >
        Clear All
      </button>
      <div id="sessions-status" className="status">
        Connecting...
      </div>
      <div id="sessions-list" data-init={`@get('/sessions/${ip}/stream')`}>
        <ul id="sessions-ul">
          <li class="empty">(loading)</li>
        </ul>
      </div>
      <div id="delete-session-result" className="result" />
      <h2>Create Session</h2>
      <form
        id="create-session-form"
        data-on:submit={`@post('/sessions/${ip}/create-session', { title: document.querySelector('#new-session-title').value })`}
      >
        <div className="row">
          <input
            id="new-session-title"
            type="text"
            placeholder="Session title"
            value="new session"
          />
          <button type="submit">Create</button>
        </div>
        <div id="create-session-result" className="result" />
      </form>
    </Layout>
  );
}
