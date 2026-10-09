import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/geist-mono/500.css";
import "./fonts/libron/libron.css";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { AdminPage } from "./pages/Admin";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { Cheatsheets } from "./pages/Cheatsheets";
import { CheatsheetView } from "./pages/CheatsheetView";
import { Dashboard } from "./pages/Dashboard";
import { ExercisePlayer } from "./pages/ExercisePlayer";
import { Flashcards } from "./pages/Flashcards";
import { Exercises } from "./pages/Exercises";
import { ImportPage } from "./pages/Import";
import { Login } from "./pages/Login";
import { NoteEditor } from "./pages/NoteEditor";
import { NotesPage } from "./pages/Notes";
import { OAuthConsent } from "./pages/OAuthConsent";
import { SeriesPage } from "./pages/SeriesPage";
import { SettingsPage } from "./pages/Settings";
import { StoriesPage } from "./pages/Stories";
import { StoryEditor } from "./pages/StoryEditor";
import { StoryGenerate } from "./pages/StoryGenerate";
import { StoryReader } from "./pages/StoryReader";
import { VocabPage } from "./pages/Vocab";

// Inlined at build time (not IS_NATIVE from lib/platform) so the web build
// drops the app's screens and Capacitor entirely.
const IS_NATIVE = import.meta.env.VITE_TARGET === "native";

/** The app's own screens (connect to a server, sign in through OAuth). */
function nativeRoutes() {
  const Connect = lazy(() => import("./pages/native/Connect").then((m) => ({ default: m.Connect })));
  const SignIn = lazy(() => import("./pages/native/SignIn").then((m) => ({ default: m.SignIn })));
  return [
    { path: "/connect", element: <Suspense><Connect /></Suspense> },
    { path: "/login", element: <Suspense><SignIn /></Suspense> },
  ];
}

const router = createBrowserRouter([
  ...(IS_NATIVE ? nativeRoutes() : [{ path: "/login", element: <Login /> }]),
  { path: "/oauth/authorize", element: <OAuthConsent /> },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "cheatsheets", element: <Cheatsheets /> },
      { path: "cheatsheets/:id", element: <CheatsheetView /> },
      { path: "exercises", element: <Exercises /> },
      { path: "exercises/:id", element: <ExercisePlayer /> },
      { path: "stories", element: <StoriesPage /> },
      { path: "series/:id", element: <SeriesPage /> },
      { path: "stories/new", element: <StoryEditor /> },
      { path: "stories/generate", element: <StoryGenerate /> },
      { path: "stories/:id", element: <StoryReader /> },
      { path: "stories/:id/edit", element: <StoryEditor key="edit" /> },
      { path: "vocab", element: <VocabPage /> },
      { path: "vocab/study", element: <Flashcards /> },
      { path: "notes", element: <NotesPage /> },
      { path: "notes/:id", element: <NoteEditor /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/:tab", element: <SettingsPage /> },
      { path: "admin", element: <AdminPage /> },
      { path: "admin/:tab", element: <AdminPage /> },
      { path: "import", element: <ImportPage /> },
    ],
  },
]);

async function start() {
  // The app needs its server before anything asks the API.
  if (IS_NATIVE) await (await import("./lib/native/server")).loadServer();
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </StrictMode>,
  );
}
void start();
