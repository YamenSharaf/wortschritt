import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Config = { appName: string; appEmoji: string };
const DEFAULT: Config = { appName: "mit dem baby", appEmoji: "🍼" };
const ConfigContext = createContext<Config>(DEFAULT);

/** Render an emoji as an SVG favicon. */
function setFavicon(emoji: string) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<text x="50" y="52" font-size="76" text-anchor="middle" dominant-baseline="central">${emoji}</text></svg>`;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>(DEFAULT);
  useEffect(() => {
    fetch("/api/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((c: Config) => {
        if (!c?.appName) return;
        setConfig(c);
        document.title = `${c.appName} — Learn German`;
        setFavicon(c.appEmoji);
      })
      .catch(() => {});
  }, []);
  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}

export const useConfig = () => useContext(ConfigContext);
