"use client";

import { BorderBeam } from "@/components/magicui/border-beam";
import TextShimmer from "@/components/magicui/text-shimmer";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useInView } from "framer-motion";
import { useRef } from "react";

export default function HeroSection({ dict }: { dict: Dictionary }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="hero"
      className="relative mx-auto mt-[5.5rem] max-w-[80rem] px-6 text-center md:px-8"
    >
      <div className="backdrop-filter-[12px] inline-flex h-7 items-center justify-between rounded-full border border-border bg-black/5 px-3 text-xs text-gray-700 transition-all ease-in hover:cursor-pointer hover:bg-black/10 group gap-1 translate-y-[-1rem] animate-fade-in opacity-0 dark:border-white/15 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
        <TextShimmer className="inline-flex items-center justify-center text-gray-700 dark:text-gray-200">
          <span>{dict.hero.badge}</span>
        </TextShimmer>
      </div>
      <h1 className="bg-gradient-to-br dark:from-white from-black from-30% dark:to-white/70 to-gray-600 bg-clip-text py-6 text-5xl font-medium leading-none tracking-tighter text-transparent text-balance sm:text-6xl md:text-7xl lg:text-8xl translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:200ms]">
        {dict.hero.title}
      </h1>
      <p className="mx-auto mb-8 max-w-3xl text-lg tracking-tight text-gray-500 md:text-xl dark:text-gray-400 text-balance translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:400ms]">
        {dict.hero.description}
      </p>
      <div className="flex translate-y-[-1rem] animate-fade-in flex-col items-center gap-3 opacity-0 ease-in-out [--animation-delay:600ms]">
        <Button
          asChild
          className="group gap-1 rounded-lg text-white dark:text-black"
          size="lg"
        >
          <a
            href="/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
            download
          >
            <span>{dict.hero.primaryButton}</span>
            <ArrowRightIcon className="ml-1 size-4 transition-transform duration-300 ease-in-out group-hover:translate-x-1" />
          </a>
        </Button>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {dict.hero.subNote}
        </p>
        <p className="max-w-md text-xs text-gray-600 text-balance dark:text-gray-500">
          {dict.hero.gatekeeperPrefix}
          <a
            href="mailto:kontakt@coderoad.pl?subject=AI%20Video%20Cataloger%20feedback"
            className="text-gray-800 underline underline-offset-4 transition-colors hover:text-black dark:text-gray-300 dark:hover:text-white"
          >
            {dict.hero.gatekeeperLink}
          </a>
          {dict.hero.gatekeeperSuffix}
        </p>
      </div>
      <div
        ref={ref}
        className="relative mt-[8rem] animate-fade-up opacity-0 [--animation-delay:400ms] [perspective:2000px] after:absolute after:inset-0 after:z-50 after:[background:linear-gradient(to_top,var(--background)_0%,transparent_25%)]"
      >
        <div
          className={`rounded-xl border border-border bg-white bg-opacity-[0.01] before:absolute before:bottom-1/2 before:left-0 before:top-0 before:h-full before:w-full before:opacity-0 before:[filter:blur(180px)] before:[background-image:linear-gradient(to_bottom,var(--color-one),var(--color-one),transparent_40%)] ${
            inView ? "before:animate-image-glow" : ""
          }`}
        >
          <BorderBeam
            size={200}
            duration={12}
            delay={11}
            colorFrom="var(--color-one)"
            colorTo="var(--color-two)"
          />
          <img
            src="/hero-dark.webp"
            alt={dict.hero.imageAlt}
            fetchPriority="high"
            className="relative hidden h-full w-full rounded-[inherit] border object-contain dark:block"
          />
          <img
            src="/hero-light.webp"
            alt={dict.hero.imageAlt}
            fetchPriority="high"
            className="relative block h-full w-full rounded-[inherit] border object-contain dark:hidden"
          />
        </div>
      </div>
    </section>
  );
}
