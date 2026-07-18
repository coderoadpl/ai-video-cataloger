"use client";

import { buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function SiteHeader({ dict }: { dict: Dictionary }) {
  const isEnglish = dict.locale === "en";
  const homeHref = isEnglish ? "/" : "/pl/";
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const isDark = mounted ? resolvedTheme === "dark" : true;

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 px-4 opacity-0 backdrop-blur-[12px] animate-fade-in [--animation-delay:600ms] dark:bg-transparent">
      <div className="container mx-auto flex h-[var(--navigation-height)] w-full items-center justify-between">
        <div className="flex items-center gap-8">
          <Link className="text-md flex items-center gap-2" href={homeHref}>
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              className="h-7 w-7"
            />
            <span className="font-medium">AI Video Cataloger</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-gray-600 dark:text-gray-400 md:flex">
            <a className="transition-colors hover:text-black dark:hover:text-white" href="#how-it-works">
              {dict.header.nav.howItWorks}
            </a>
            <a className="transition-colors hover:text-black dark:hover:text-white" href="#features">
              {dict.header.nav.features}
            </a>
            <a className="transition-colors hover:text-black dark:hover:text-white" href="#faq">
              {dict.header.nav.faq}
            </a>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 text-xs font-medium text-gray-500" aria-label={dict.header.languageLabel}>
            <Link
              href="/"
              className={cn(
                "px-1 transition-colors hover:text-black dark:hover:text-white",
                isEnglish && "text-black dark:text-white"
              )}
              aria-current={isEnglish ? "page" : undefined}
            >
              EN
            </Link>
            <span aria-hidden="true">|</span>
            <Link
              href="/pl/"
              className={cn(
                "px-1 transition-colors hover:text-black dark:hover:text-white",
                !isEnglish && "text-black dark:text-white"
              )}
              aria-current={!isEnglish ? "page" : undefined}
            >
              PL
            </Link>
          </nav>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-md border bg-background text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={
              isDark ? dict.header.themeToggle.light : dict.header.themeToggle.dark
            }
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <a
            className={cn(buttonVariants({ variant: "secondary" }), "text-sm")}
            href="/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
            download
          >
            {dict.header.download}
          </a>
        </div>
      </div>
    </header>
  );
}
