import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { loadAccessList } from "@/lib/auth/access";
import { ROLE_LABELS } from "@/lib/auth/constants";
import { safeNextPath } from "@/lib/auth/paths";
import { getSessionUser } from "@/lib/auth/session";
import { FormError } from "@/components/auth/fields";
import { cardClass, linkButtonClass } from "@/components/auth/styles";

export const metadata: Metadata = { title: "Choose organization · BovineSense" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  forbidden: "You do not have access to that organization.",
  invalid: "That organization could not be opened. Pick one from the list.",
};

export default async function SelectOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const next = safeNextPath(params.next);

  const { organizations } = await loadAccessList(user.id);
  // Nothing to choose from: /org/continue signs the user out with an explanation.
  if (organizations.length === 0) redirect("/org/continue");

  return (
    <section className={cardClass}>
      <h1 className="text-2xl font-semibold leading-8 text-text-primary">Choose an organization</h1>
      <p className="mt-1 text-[0.8125rem] leading-[1.125rem] text-text-secondary">
        Signed in as {user.email ?? "your account"}.
      </p>

      {params.error && ERRORS[params.error] && (
        <div className="mt-4">
          <FormError>{ERRORS[params.error]}</FormError>
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {organizations.map((org) => (
          <li key={org.id}>
            <form method="post" action="/org/select">
              <input type="hidden" name="organization_id" value={org.id} />
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-3 py-3 text-left outline-none transition-colors hover:bg-bg-sunken focus-visible:border-brand focus-visible:ring-1 focus-visible:ring-brand/30"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-text-primary">
                    {org.name}
                  </span>
                  <span className="block truncate text-[0.8125rem] leading-[1.125rem] text-text-secondary">
                    {org.viaPlatform ? "Platform access" : ROLE_LABELS[org.role]}
                  </span>
                </span>
                <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-text-secondary" />
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form method="post" action="/auth/signout" className="mt-6 border-t border-border pt-4">
        <button type="submit" className={linkButtonClass}>Sign out</button>
      </form>
    </section>
  );
}
