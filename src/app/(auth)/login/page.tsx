import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNextPath } from "@/lib/auth/paths";

export const metadata: Metadata = { title: "Sign in · BovineSense" };

const NOTICES: Record<string, string> = {
  no_access:
    "Your account is not a member of any active organization. Contact your administrator.",
  session_expired: "Your session has expired. Sign in again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const params = await searchParams;
  const notice =
    (params.error && NOTICES[params.error]) ||
    (params.reset ? "Your password was updated. Sign in with the new one." : null);

  return <LoginForm next={safeNextPath(params.next)} notice={notice} />;
}
