import { APP_NAME } from "@mdb/shared";

/** The app's icon and name, as in the header. */
export function AppTitle() {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <img src="/favicon.svg" alt="" className="h-6 w-6 shrink-0" />
      <span className="truncate">{APP_NAME}</span>
    </span>
  );
}
