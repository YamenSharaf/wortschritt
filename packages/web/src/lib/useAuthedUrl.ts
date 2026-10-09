import { useEffect, useState } from "react";
import { authedUrl, IS_NATIVE } from "./platform";

/**
 * `authedUrl` as a hook: the path itself on the web; natively null until the
 * file has loaded, then a blob URL that is released on unmount or path change.
 */
export function useAuthedUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(IS_NATIVE ? null : path);

  useEffect(() => {
    if (!IS_NATIVE) {
      setUrl(path);
      return;
    }
    let alive = true;
    let release = () => {};
    setUrl(null);
    authedUrl(path)
      .then((r) => {
        if (alive) {
          release = r.release;
          setUrl(r.url);
        } else r.release();
      })
      .catch(() => {});
    return () => {
      alive = false;
      release();
    };
  }, [path]);

  return url;
}
