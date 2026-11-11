import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { LoadingProvider } from "@/components/loading-overlay";
import { BalanceVisibilityProvider } from "@/components/balance-visibility";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MoonXch",
  description: "MoonXch — deposit, swap, and withdraw crypto.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${interSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <BalanceVisibilityProvider>
            <LoadingProvider>{children}</LoadingProvider>
          </BalanceVisibilityProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
