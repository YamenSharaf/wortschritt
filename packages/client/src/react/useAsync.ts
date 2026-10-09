import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

/** Minimal data-fetching hook: loading, error or the data; refetches when `deps` change. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fn()
      .then((data) => alive && setState({ status: "ready", data }))
      .catch(
        (error) =>
          alive &&
          setState({
            status: "error",
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
