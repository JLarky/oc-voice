import { h } from "preact";

interface LayoutProps {
  title: string;
  needsDatastar?: boolean;
  needsClient?: boolean;
  children: preact.ComponentChildren;
}

const BASE_STYLE = `body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:900px;margin-left:auto;margin-right:auto;} a{color:#0366d6;} input,textarea,button{padding:.5rem;font-size:.95rem;border:1px solid #ccc;border-radius:3px;} button{background:#0366d6;color:white;cursor:pointer;border:none;} button:hover{background:#0256c7;} .row{display:flex;gap:.5rem;margin-bottom:.5rem;} .status{font-size:.75rem;color:#666;margin-bottom:1rem;} .result{font-size:.75rem;color:#666;margin-top:.5rem;} #messages-list{border:1px solid #ddd;padding:1rem;border-radius:4px;margin-top:1rem;max-height:400px;overflow-y:auto;} .message{padding:.5rem;border-bottom:1px solid #eee;font-size:.9rem;} .message-role{font-weight:bold;color:#0366d6;} .message-text{margin-top:.25rem;white-space:pre-wrap;word-break:break-word;}  .session-id{font-size:.6rem;color:#666;margin-top:.25rem;margin-bottom:1rem;}`;

export function Layout({
  title,
  needsDatastar,
  needsClient,
  children,
}: LayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <title>{title}</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>{BASE_STYLE}</style>
        {needsDatastar && (
          <script
            type="module"
            src="https://cdn.jsdelivr.net/gh/starfederation/datastar@1.0.0-RC.6/bundles/datastar.js"
          />
        )}
      </head>
      <body>
        {children}
        {needsClient && <script type="module" src="/client.js"></script>}
      </body>
    </html>
  );
}
