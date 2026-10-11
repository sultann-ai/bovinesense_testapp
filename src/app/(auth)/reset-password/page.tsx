import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Set your password · BovineSense" };

// Public page (reset and invitation emails land here). All the work happens in the
// browser: the link's one-time code or token is exchanged for a session there.
export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
