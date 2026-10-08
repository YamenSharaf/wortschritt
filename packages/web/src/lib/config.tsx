import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type Config = { appName: string; appEmoji: string };
const DEFAULT: Config = { appName: "Wortschritt", appEmoji: "" };
const ConfigContext = createContext<Config>(DEFAULT);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config>(DEFAULT);
  useEffect(() => {
    fetch("/api/config", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((c: Config) => {
        if (!c?.appName) return;
        setConfig(c);
        document.title = `${c.appName} — Learn German`;
      })
      .catch(() => {});
  }, []);
  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}

export const useConfig = () => useContext(ConfigContext);
