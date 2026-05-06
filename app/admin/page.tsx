import { isAuthed } from "@/lib/auth";
import { readConfig } from "@/lib/config";
import LoginForm from "./LoginForm";
import AdminConsole from "./AdminConsole";
import "./admin.css";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authed = await isAuthed();
  if (!authed) return <LoginForm />;
  const config = await readConfig();
  return <AdminConsole initialConfig={config} />;
}
