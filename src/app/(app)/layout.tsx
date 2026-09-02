import { requireSession, logout } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NavLinks } from "./nav";

export const dynamic = "force-dynamic";

async function doLogout() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Inhouse Scheduler</div>
        <NavLinks />
        <div className="spacer" />
        <div className="user">{session.email}</div>
        <form action={doLogout}>
          <button className="sm" type="submit" style={{ width: "100%" }}>Sign out</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
