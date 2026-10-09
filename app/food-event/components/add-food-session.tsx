import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Link } from "react-router";

import eventStyles from "../food-event.module.css";
import { addFoodHref, FOOD_EVENT_FETCHERS } from "../links";
import { useFoodEventFetcher } from "./food-fields";

export type AddFoodMethod = "my" | "search" | "barcode" | "manual";
export type MethodHrefs = Partial<Record<AddFoodMethod, string>>;
type Drafts = Record<string, unknown>;
const Session = createContext<{ drafts: Drafts; setDrafts: Dispatch<SetStateAction<Drafts>> } | undefined>(undefined);

/** In-memory drafts belong to one open dialog on one date; unmounting discards them. */
export function AddFoodSession({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Drafts>({});
  return <Session.Provider value={{ drafts, setDrafts }}>{children}</Session.Provider>;
}

/** Keys include the product identity (or the submitted query) whenever data is product-specific. */
export function useAddFoodDraft<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const session = useContext(Session);
  if (!session) throw new Error("Add Food drafts require an open session.");
  const [initialValue] = useState(() => initial);
  const { drafts, setDrafts } = session;
  const value = Object.hasOwn(drafts, key) ? drafts[key] as T : initialValue;
  const setValue = useCallback((update: SetStateAction<T>) => {
    setDrafts((current) => {
      const previous = Object.hasOwn(current, key) ? current[key] as T : initialValue;
      const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
      return Object.is(next, previous) ? current : { ...current, [key]: next };
    });
  }, [initialValue, key, setDrafts]);
  return [value, setValue];
}

export function useMethodHref(date: string, method: AddFoodMethod): string {
  const [hrefs] = useAddFoodDraft<MethodHrefs>("method-hrefs", {});
  return hrefs[method] ?? addFoodHref(date, method);
}

/** Refusals follow their draft, without copying the shared fetcher's old error to another food. */
export function useAddFoodFetcher(draftKey: string) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.add);
  const previousData = useRef(fetcher.data);
  const waitingForPreviousSubmission = useRef(fetcher.state !== "idle");
  const [message, setMessage] = useAddFoodDraft<string | undefined>(`${draftKey}:error`, undefined);
  const currentMessage = !waitingForPreviousSubmission.current && fetcher.data !== previousData.current
    ? fetcher.data?.message : undefined;
  useEffect(() => {
    if (waitingForPreviousSubmission.current && fetcher.state === "idle") {
      previousData.current = fetcher.data;
      waitingForPreviousSubmission.current = false;
    }
  }, [fetcher.data, fetcher.state]);
  useEffect(() => {
    if (currentMessage) setMessage(currentMessage);
  }, [currentMessage, setMessage]);
  return { ...fetcher, message: currentMessage ?? message };
}

/** Error recovery opens the existing manual draft, with the dialog's date intact. */
export function ManualEntryLink({ date, message }: { date: string; message?: string }) {
  const href = useMethodHref(date, "manual");
  return message && /manual(?:ly| entry)/i.test(message) ? (
    <Link className={eventStyles.backToResults} to={href}>Add manually</Link>
  ) : null;
}
