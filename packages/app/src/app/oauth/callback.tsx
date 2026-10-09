import { Redirect } from "expo-router";

/** Where the sign-in browser returns; expo-auth-session takes the code from here. */
export default function OAuthCallback() {
  return <Redirect href="/" />;
}
