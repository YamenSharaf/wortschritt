/** Native start-up: the server and tokens, before the app renders. */
import { listenForSignIn, loadTokens } from "./auth";
import { loadServer } from "./server";

export async function startNative(): Promise<void> {
  await Promise.all([loadServer(), loadTokens()]);
  listenForSignIn();
}
