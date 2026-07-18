import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { Inter as FontSans } from "next/font/google";
import "./globals.css";

const fontSans = FontSans({
  subsets: ["latin"],
  variable: "--font-sans",
});
export const metadata: Metadata = {
  metadataBase: new URL("https://ai-video-cataloger.web.app"),
  title: "AI Video Cataloger - AI-organized video library for macOS",
  description:
    "Local-first macOS app that watches, transcribes, summarizes and renames videos by what is inside, with local Ollama, OpenAI-compatible APIs, or agent CLIs.",
  openGraph: {
    title: "AI Video Cataloger - AI-organized video library for macOS",
    description:
      "Local-first macOS app that watches, transcribes, summarizes and renames videos by what is inside, with local Ollama, OpenAI-compatible APIs, or agent CLIs.",
    url: "/",
    siteName: "AI Video Cataloger",
    images: [{ url: "/hero-dark.png", width: 2320, height: 1624 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Video Cataloger - AI-organized video library for macOS",
    description:
      "Local-first macOS app that watches, transcribes, summarizes and renames videos by what is inside, with local Ollama, OpenAI-compatible APIs, or agent CLIs.",
    images: ["/hero-dark.png"],
  },
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          fontSans.variable
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
