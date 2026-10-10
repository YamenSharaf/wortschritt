import { useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

/**
 * Minimal data-fetching hook: loading, error or the data; refetches when `deps`
 * change. `keep`: a refetch keeps showing the data it has until the new data
 * arrives (a list reloading after a sync, rather than flashing "loading").
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { keep?: boolean } = {}): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState((cur) => (opts.keep && cur.status === "ready" ? cur : { status: "loading" }));
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
