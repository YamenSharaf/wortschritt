import { createContext, useContext, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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
  /** Side by side (a tablet in landscape): answer controls show here, beside the card, not in it. */
  answers?: AnswerSlot;
};

/** Where an item's answer controls go when they sit outside its card. */
export type AnswerSlot = { get: () => ReactNode; set: (node: ReactNode) => void; subscribe: (fn: () => void) => () => void };

export function answerSlot(): AnswerSlot {
  let node: ReactNode = null;
  const subs = new Set<() => void>();
  return {
    get: () => node,
    set: (n) => {
      node = n;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

/** The answer controls an item put in the slot (it re-renders on its own, not the item). */
export function AnswerHost({ slot }: { slot: AnswerSlot }) {
  const node = useSyncExternalStore(slot.subscribe, slot.get);
  return node ? <View style={{ gap: 10 }}>{node}</View> : null;
}

export const ExerciseLayout = createContext<Layout | null>(null);

/** Where the tutor's reply shows: under the question (and its result); beside the card on a tablet. */
export function TutorSlot() {
  const layout = useContext(ExerciseLayout);
  if (!layout?.panel || layout.answers) return null;
  return <View style={{ marginTop: 16 }}>{layout.panel}</View>;
}

/** Answer controls, at the bottom of the card (the space above them stays free), or beside it on a tablet. */
export function AnswerZone({ children }: { children: ReactNode }) {
  const slot = useContext(ExerciseLayout)?.answers;
  useLayoutEffect(() => {
    slot?.set(children);
  });
  useLayoutEffect(() => (slot ? () => slot.set(null) : undefined), [slot]);
  if (slot) return null;
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
