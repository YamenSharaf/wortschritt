import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/lato/400.css";
import "@fontsource/lato/700.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import "./index.css";
import { AuthProvider } from "./lib/auth";
import { ConfigProvider } from "./lib/config";
import { ThemeProvider } from "./lib/theme";
import { Cheatsheets } from "./pages/Cheatsheets";
import { CheatsheetView } from "./pages/CheatsheetView";
import { Dashboard } from "./pages/Dashboard";
import { ExercisePlayer } from "./pages/ExercisePlayer";
import { Exercises } from "./pages/Exercises";
import { ImportPage } from "./pages/Import";
import { Login } from "./pages/Login";
import { NoteEditor } from "./pages/NoteEditor";
import { NotesPage } from "./pages/Notes";
import { SettingsPage } from "./pages/Settings";
import { VocabPage } from "./pages/Vocab";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "cheatsheets", element: <Cheatsheets /> },
      { path: "cheatsheets/:id", element: <CheatsheetView /> },
      { path: "exercises", element: <Exercises /> },
      { path: "exercises/:id", element: <ExercisePlayer /> },
      { path: "vocab", element: <VocabPage /> },
      { path: "notes", element: <NotesPage /> },
      { path: "notes/:id", element: <NoteEditor /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "import", element: <ImportPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ConfigProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </ConfigProvider>
    </ThemeProvider>
  </StrictMode>,
);
