import { redirect } from "next/navigation";
import { login, getSession, ensureAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function doLogin(formData: FormData) {
  "use server";
  const ok = await login(String(formData.get("email") ?? ""), String(formData.get("password") ?? ""));
  redirect(ok ? "/review" : "/login?error=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await ensureAdmin();
  if (await getSession()) redirect("/review");
  const { error } = await searchParams;
  return (
    <div className="login card">
      <h1>Inhouse Scheduler</h1>
      {error && <div className="alert danger">Wrong email or password.</div>}
      <form action={doLogin}>
        <div className="field">
          <label>Email</label>
          <input type="email" name="email" required autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" name="password" required />
        </div>
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}
