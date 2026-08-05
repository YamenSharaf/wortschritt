import { useEffect, useState } from "react";

type State<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

/** Minimal data-fetching hook — enough for a single-user app, no deps. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): State<T> {
  const [state, setState] = useState<State<T>>({ status: "loading" });

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
