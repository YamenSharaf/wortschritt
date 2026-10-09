// Test helpers: render a hook under a ClientProvider without a DOM.
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { Api } from "../api";
import type { Speech } from "../speech";
import { ClientProvider } from "./context";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Render a hook with a fake API (and speech); `current()` is its latest return value. */
export function renderHook<T>(hook: () => T, api: Partial<Api>, speech?: Partial<Speech>) {
  let value: T;
  const Probe = () => {
    value = hook();
    return null;
  };
  let root!: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(
      createElement(ClientProvider, { api: api as Api, speech: speech as Speech | undefined }, createElement(Probe)),
    );
  });
  return { current: () => value, unmount: () => act(() => root.unmount()) };
}

/** Let pending promises (fake API answers) settle. */
export const flush = () => act(async () => {});

export { act };
