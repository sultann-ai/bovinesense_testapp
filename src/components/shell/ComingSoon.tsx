import { Construction } from "lucide-react";

interface ComingSoonProps {
  title: string;
  description?: string;
}

export function ComingSoon({ title, description }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center">
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-[var(--radius-md)]"
        style={{ backgroundColor: "var(--bg-sunken)" }}
      >
        <Construction size={24} style={{ color: "var(--text-secondary)" }} />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-1">{title}</h2>
      <p className="text-sm text-text-secondary max-w-xs">
        {description ?? "This screen is on the roadmap and will be available soon."}
      </p>
    </div>
  );
}
