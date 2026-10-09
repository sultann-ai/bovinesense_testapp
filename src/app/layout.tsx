import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/shell/Sidebar";
import { TopBar } from "@/components/shell/TopBar";
import { DemoModeBanner } from "@/components/shell/DemoModeBanner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Bovine Track — BOP Dashboard",
  description: "Bank of Punjab livestock collateral monitoring dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${ibmPlexMono.variable} h-full`}>
      <body className="flex h-full overflow-hidden antialiased">
        {/* Left rail */}
        <Sidebar />

        {/* Right column: top bar + demo banner + content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <DemoModeBanner />
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
