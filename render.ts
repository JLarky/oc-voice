// render.ts - HTML rendering and template helpers

// Escape HTML
const ESCAPE_RE = /[&<>"]/g;
const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
export function escapeHtml(text: string): string {
  if (typeof text !== 'string' || text === '') return String(text || '');
  ESCAPE_RE.lastIndex = 0;
  if (!ESCAPE_RE.test(text)) return text;
  ESCAPE_RE.lastIndex = 0;
  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ESCAPE_RE.exec(text))) {
    const i = match.index;
    out += text.slice(lastIndex, i) + ESCAPE_MAP[text[i]];
    lastIndex = i + 1;
  }
  return out + text.slice(lastIndex);
}

// Datastar patch helper (SSE wrapper for element patches)
export function sendDatastarPatchElements(html: string): string {
  const lines = html.split('\n');
  let result = 'event: datastar-patch-elements\n';
  lines.forEach((line) => {
    result += `data: elements ${line}\n`;
  });
  result += '\n';
  return result;
}

interface SessionDetailProps {
  ip: string;
  sessionId: string;
  sessionTitle: string;
}
export function renderSessionDetailPage({ ip, sessionId, sessionTitle }: SessionDetailProps): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Session ${escapeHtml(sessionTitle || sessionId)}</title><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;color:#0366d6;} .message-text{margin-top:.25rem;white-space:pre-wrap;word-break:break-word;}  .session-id{font-size:.6rem;color:#666;margin-top:.25rem;margin-bottom:1rem;} </style></head><body><h1>${escapeHtml(sessionTitle || sessionId)}</h1><div><a href="/sessions/${escapeHtml(ip)}">&larr; Back to sessions for ${escapeHtml(ip)}</a></div><speech-button></speech-button><h2>Messages</h2><div id="messages-status" class="status">Connecting...</div><messages-wrapper><div id="messages-list-container"><div id="messages-list" data-init="@get('/sessions/${escapeHtml(ip)}/${escapeHtml(sessionId)}/messages/stream')"><div>(loading)</div></div></div></messages-wrapper><h2>Send Message</h2><form id="session-message-form" data-on:submit="@post('/sessions/${escapeHtml(ip)}/${escapeHtml(sessionId)}/message'); $messagetext = ''"><div class="row"><textarea id="session-message-input" data-bind:messageText name="messageText" placeholder="Enter message" rows="4" style="flex:1;resize:vertical"></textarea><button type="submit">Send</button></div><div id="session-message-result" class="result"></div></form><script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"></script><script type="module" src="/client.js"></script><script>(function(){var attempts=0;function s(){var el=document.getElementById('messages-list');if(!el||!el.querySelector('.message')){if(attempts++<30) return setTimeout(s,100);return;}el.scrollTop=el.scrollHeight;}s();})();</script><script>(function(){var ta=document.getElementById('session-message-input');var form=document.getElementById('session-message-form');if(!ta||!form) return;ta.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit();}});})();</script></body></html>`;
}

interface SessionsListProps { ip: string; }
export function renderSessionsListPage({ ip }: SessionsListProps): string {
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"/><title>Sessions for ${escapeHtml(ip)}</title><meta name="viewport" content="width=device-width,initial-scale=1" /><style>body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #sessions-ul{list-style:none;padding:0;} #sessions-ul li{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} #sessions-ul li:last-child{border-bottom:none;} #sessions-ul li span.id{font-family:monospace;color:#333;font-size:.85rem;} .delete-btn{background:#e74c3c;color:#fff;border:none;padding:0 .4rem;font-size:.75rem;cursor:pointer;border-radius:3px;} .delete-btn:hover{background:#c0392b;} </style></head><body><h1>Sessions for ${escapeHtml(ip)}</h1><div><a href="/">&larr; Back home</a></div><h2>Sessions</h2><button style="background:#e74c3c;color:#fff;margin-bottom:.5rem;padding:.25rem .5rem;font-size:.7rem;border:none;border-radius:3px;cursor:pointer" data-on:click="@post('/sessions/${escapeHtml(ip)}/clear-sessions')">Clear All</button><div id="sessions-status" class="status">Connecting...</div><div id="sessions-list" data-init="@get('/sessions/${escapeHtml(ip)}/stream')"><ul id="sessions-ul"><li class="empty">(loading)</li></ul></div><div id="delete-session-result" class="result"></div><h2>Create Session</h2><form id="create-session-form" data-on:submit="@post('/sessions/${escapeHtml(ip)}/create-session', { title: document.querySelector('#new-session-title').value })"><div class="row"><input id="new-session-title" type="text" placeholder="Session title" value="new session" /><button type="submit">Create</button></div><div id="create-session-result" class="result"></div></form><script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"></script></body></html>`;
}
