declare module "preact" {
  namespace JSX {
    interface IntrinsicElements {
      "messages-wrapper": {
        children?: preact.ComponentChildren;
        [key: string]: any;
      };
      "speech-button": {
        children?: preact.ComponentChildren;
        [key: string]: any;
      };
      "submit-on-enter": {
        children?: preact.ComponentChildren;
        style?: preact.JSX.CSSProperties;
        [key: string]: any;
      };
      "session-message-result": {
        children?: preact.ComponentChildren;
        [key: string]: any;
      };
    }
  }
}

export {};
