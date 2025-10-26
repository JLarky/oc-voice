import { JSX } from "preact";
import { render } from "preact-render-to-string";

// datastar.ts - build Datastar SSE patch lines from JSX
// sendDatastarPatchElements helper removed (unused externally)
export function dataStarPatchElementsString(jsx: JSX.Element): string {
  const html = render(jsx);
  const lines = html.split("\n");
  let result = "event: datastar-patch-elements\n";
  for (const line of lines) result += `data: elements ${line}\n`;
  result += "\n";
  return result;
}
