import { useEffect, useState } from "react";
import { preferences, type Preference } from "@mdb/client";
import { usePreference } from "@mdb/client/react";

/** Phone-sized screens, where moving on by itself has always been the default. */
const PHONE = "(max-width: 767px)";

// The app's "move on after a right answer", with one more state on the web:
// not chosen yet (null), which follows the screen size.
const autoAdvance: Preference<boolean | null> = {
  key: preferences.autoAdvance.key,
  fallback: null,
  parse: (raw) => (raw === "true" ? true : raw === "false" ? false : undefined),
};

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

/** Whether practice moves on after a right answer in this browser: your choice, else on for phones only. */
export function useAutoAdvance(): [boolean, (on: boolean) => void] {
  const [chosen, setChosen] = usePreference(autoAdvance);
  const phone = usePhone();
  return [chosen ?? phone, (on) => setChosen(on)];
}
