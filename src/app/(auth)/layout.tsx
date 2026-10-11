import { BrandMark } from "@/components/shell/BrandMark";

// Shared frame for the sign-in, password-reset and organization-picker pages:
// cream page background, the product mark, and a single centered column. No shell.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center overflow-y-auto bg-bg-app px-4 py-12">
      <div className="my-auto w-full max-w-[400px]">
        <div className="mb-6 flex justify-center">
          <BrandMark variant="logo" height={64} />
        </div>
        {children}
      </div>
    </div>
  );
}
