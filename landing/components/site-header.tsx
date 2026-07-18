"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="fixed left-0 top-12 z-50 w-full px-4 animate-fade-in border-b opacity-0 backdrop-blur-[12px] [--animation-delay:600ms]">
      <div className="container mx-auto flex h-[var(--navigation-height)] w-full items-center justify-between">
        <Link className="text-md flex items-center gap-2" href="/">
          <img
            src="/logo.svg"
            alt=""
            aria-hidden="true"
            className="h-7 w-7"
          />
          <span className="font-medium">AI Video Cataloger</span>
        </Link>
        <a
          className={cn(buttonVariants({ variant: "secondary" }), "text-sm")}
          href="/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
          download
        >
          Download
        </a>
      </div>
    </header>
  );
}
