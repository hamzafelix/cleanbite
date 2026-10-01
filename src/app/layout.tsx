import type { Metadata, Viewport } from "next";
import "./globals.css";
import ScannerApp from "@/components/scanner-app";

export const metadata: Metadata = {
  title: "CleanBite — Food label health score",
  description: "Snap ingredients + nutrition facts, get a 0–100 health score. EN/AR/FR/DE.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout() {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-white text-zinc-950 dark:bg-black dark:text-zinc-50">
        <ScannerApp />
      </body>
    </html>
  );
}
