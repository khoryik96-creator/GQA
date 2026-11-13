import type { Metadata } from "next";
import "./globals.css";
import "./browser-flow.css";
import "./team.css";
import "./account-security.css";
import "./broker-jobs.css";
import "./quality.css";

export const metadata: Metadata = {
  title: "GQA | Principal QA Command Center",
  description: "Project-aware, memory-driven AI QA engineering command center."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
