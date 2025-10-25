// messages.tsx - message item rendering via Preact JSX (simplified)
import { render } from "preact-render-to-string";
import { MessageItems, Msg } from "./MessageItems";

export function renderMessageItems(messages: Msg[]): string {
  return render(<MessageItems messages={messages} />);
}
