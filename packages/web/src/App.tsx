import { Navigate, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "./lib/auth";

const navItems = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/cheatsheets", label: "Cheat sheets" },
  { to: "/exercises", label: "Exercises" },
  { to: "/import", label: "Import" },
  { to: "/settings", label: "Settings" },
];

export function App() {
  const { authenticated, loading, logout } = useAuth();

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-slate-500">
        Loading…
      </div>
    );
  }

  // Declarative redirect — never call navigate() during render.
  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <span className="text-lg font-bold">mit dem baby 🍼</span>
          <nav className="flex flex-1 gap-1 text-sm">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 ${
                    isActive
                      ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                      : "hover:bg-slate-100 dark:hover:bg-slate-800"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
