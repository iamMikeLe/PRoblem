/** jsdom has no ResizeObserver; Fluent's MessageBar uses one to reflow its actions. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!("ResizeObserver" in globalThis)) {
  // Writable: Fluent's positioning code assigns its own fallback when it opens a popup.
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    writable: true,
    configurable: true,
  });
}
