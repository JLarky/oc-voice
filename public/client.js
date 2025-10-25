// node_modules/@lift-html/core/esm/mod.js
var HTMLElement_ = typeof HTMLElement !== "undefined" ? HTMLElement : class {
};

class LiftBaseClass extends HTMLElement_ {
  static options;
  static formAssociated;
  static observedAttributes;
}
function liftHtml(tagName, opts) {

  class LiftElement extends LiftBaseClass {
    static hmr = new Set;
    acb = undefined;
    static options = opts;
    options = opts;
    static observedAttributes = opts.observedAttributes;
    static formAssociated = opts.formAssociated;
    attributeChangedCallback(attrName, _oldValue, newValue) {
      this.acb?.(attrName, newValue);
    }
    connectedCallback() {
      this.cb(true);
    }
    adoptedCallback() {
      this.cb(true);
    }
    disconnectedCallback() {
      this.cb();
      this.acb = undefined;
      LiftElement.hmr.delete(this);
    }
    cleanup = [];
    cb(connect) {
      while (this.cleanup.length) {
        this.cleanup.pop()();
      }
      if (this.isConnected && connect) {
        LiftElement.options.init?.call(this, (cb) => {
          this.cleanup.push(cb);
        });
      }
      if (!opts.noHMR) {
        LiftElement.hmr.add(this);
      }
    }
  }
  if (typeof customElements !== "undefined") {
    const existing = customElements.get(tagName);
    if (existing) {
      if (!opts.noHMR) {
        existing.options = opts;
        existing.hmr.forEach((cb) => cb.cb(true));
      }
      return existing;
    }
    customElements.define(tagName, LiftElement);
  }
  return LiftElement;
}

// src/client.ts
liftHtml("messages-wrapper", {
  init() {
    console.log("hello world 12345", this);
    const root = this;
    const scroll = () => {
      const list = root.querySelector("#messages-list");
      if (!list)
        return;
      list.scrollTop = list.scrollHeight;
    };
    scroll();
    const intervalId = setInterval(scroll, 2000);
    root.__autoScrollInterval = intervalId;
  }
});
