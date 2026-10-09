/** Native start-up: the server and tokens, before the app renders. */
import { listenForSignIn, loadTokens } from "./auth";
import { startDevice } from "./device";
import { loadServer } from "./server";

export async function startNative(): Promise<void> {
  document.documentElement.dataset.native = "";
  await Promise.all([loadServer(), loadTokens(), startDevice()]);
  listenForSignIn();
}
