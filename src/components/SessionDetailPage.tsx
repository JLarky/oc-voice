export function SessionDetailPage(props: {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}) {
  return (
    <html>
      <head>
        <meta charSet="UTF-8" />
        <title>Session new session</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style
          dangerouslySetInnerHTML={{
            __html:
              "body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;color:#0366d6;} .message-text{margin-top:.25rem;white-space:pre-wrap;word-break:break-word;}  .session-id{font-size:.6rem;color:#666;margin-top:.25rem;margin-bottom:1rem;} ",
          }}
        />
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"
        ></script>
      </head>
      <body>
        <h1>{props.sessionTitle || props.sessionId}</h1>
        <div>
          <a href={`/sessions/${props.ip}`}>
            ← Back to sessions for {props.ip}
          </a>
        </div>
        <speech-button>
          <button type="button" style={{ marginTop: "1rem" }}>
            Read Summary
          </button>
          <button
            type="button"
            style={{ marginTop: "1rem", marginLeft: "0.5rem" }}
          >
            Play
          </button>
          <button
            type="button"
            style={{ marginTop: "1rem", marginLeft: "0.5rem" }}
          >
            Test
          </button>
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
              <div>(loading)</div>
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
          <div id="session-message-result" className="result" />
        </form>
        <script type="module" src="/client.js"></script>
      </body>
    </html>
  );
}
