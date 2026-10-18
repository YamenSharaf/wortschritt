import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { View } from "react-native";

/**
 * How an exercise sits on the screen: the question at the top, what you tap
 * to answer at the bottom of the card (in thumb reach), and one main button
 * in the bar under it (Skip, then Check once there's an answer, then Next).
 * An item puts its answer controls in an <AnswerZone> and, when it has a
 * Check step, offers it with useCheckAction; its <TutorSlot> (after the
 * question, or the result) is where the tutor's reply shows.
 */

/** What the bar's main button checks: an item's answer, ready or not. */
export type CheckSlot = { ready: boolean; busy: boolean; run: () => void };

type Layout = {
  /** The tutor's reply (or nothing), shown under the question. */
  panel: ReactNode;
  setCheck: (slot: CheckSlot | null) => void;
};

export const ExerciseLayout = createContext<Layout | null>(null);

/** Where the tutor's reply shows: under the question (and its result). */
export function TutorSlot() {
  const panel = useContext(ExerciseLayout)?.panel;
  return panel ? <View style={{ marginTop: 16 }}>{panel}</View> : null;
}

/** Answer controls, at the bottom of the card (the space above them stays free). */
export function AnswerZone({ children }: { children: ReactNode }) {
  return <View style={{ marginTop: "auto", paddingTop: 24, gap: 10 }}>{children}</View>;
}

/** Offer this item's Check to the bar while `active` (not yet answered). */
export function useCheckAction(ready: boolean, busy: boolean, run: () => void, active: boolean) {
  const setCheck = useContext(ExerciseLayout)?.setCheck;
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!setCheck) return;
    setCheck(active ? { ready, busy, run: () => latest.current() } : null);
  }, [setCheck, ready, busy, active]);
  useEffect(() => () => setCheck?.(null), [setCheck]);
}
