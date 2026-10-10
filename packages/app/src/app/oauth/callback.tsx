import { Redirect } from "expo-router";
import { useServer } from "@/lib/server";

/**
 * Where the sign-in browser returns; expo-auth-session takes the code from
 * the link itself. The tabs only exist once signed in (Stack.Protected), so
 * until the code is traded for tokens this goes back to sign-in, which shows
 * any error; signing in then moves on to the tabs.
 */
export default function OAuthCallback() {
  const { status } = useServer();
  if (status === "loading") return null;
  if (status === "signed-in") return <Redirect href="/" />;
  if (status === "no-server") return <Redirect href="/connect" />;
  return <Redirect href="/sign-in" />;
}
