import { Navigate, useNavigate, useParams } from "react-router-dom";
import { TabPills } from "../components/TabPills";
import { useAuth } from "@mdb/client/react";
import { ServerAdmin, UsersAdmin } from "./UsersAdmin";

const ADMIN_TABS = [
  { value: "users", label: "Users" },
  { value: "server", label: "Server" },
] as const;

/** Admin only: accounts and server-wide settings, apart from anyone's personal Settings. */
export function AdminPage() {
  const { user } = useAuth();
  const { tab } = useParams();
  const navigate = useNavigate();
  if (user?.role !== "admin") return <Navigate to="/settings" replace />;
  const current = ADMIN_TABS.find((t) => t.value === tab)?.value;
  if (!current) return <Navigate to="/admin/users" replace />;
  return (
    <div>
      <h1 className="mb-4 text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">Administration</h1>
      <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
        <TabPills
          label="Administration sections"
          value={current}
          onChange={(t) => navigate(`/admin/${t}`)}
          options={ADMIN_TABS}
        />
      </div>
      {current === "users" && <UsersAdmin />}
      {current === "server" && <ServerAdmin />}
    </div>
  );
}
