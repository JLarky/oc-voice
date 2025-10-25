// datastar.ts - helpers for building Datastar SSE patches
export function sendDatastarPatchElements(html: string): string {
  const lines = html.split("\n");
  let result = "event: datastar-patch-elements\n";
  lines.forEach((line) => {
    result += `data: elements ${line}\n`;
  });
  result += "\n";
  return result;
}
