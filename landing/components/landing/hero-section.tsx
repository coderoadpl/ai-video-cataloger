"use client";

import { BorderBeam } from "@/components/magicui/border-beam";
import TextShimmer from "@/components/magicui/text-shimmer";
import { Button } from "@/components/ui/button";
import { ArrowRightIcon } from "@radix-ui/react-icons";
import { useInView } from "framer-motion";
import { useRef } from "react";

export default function HeroSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section
      id="hero"
      className="relative mx-auto mt-36 max-w-[80rem] px-6 text-center md:px-8"
    >
      <div className="backdrop-filter-[12px] inline-flex h-7 items-center justify-between rounded-full border border-border bg-white/10 px-3 text-xs text-white dark:text-black transition-all ease-in hover:cursor-pointer hover:bg-white/20 group gap-1 translate-y-[-1rem] animate-fade-in opacity-0">
        <TextShimmer className="inline-flex items-center justify-center">
          <span>Local-first AI for your video library</span>
        </TextShimmer>
      </div>
      <h1 className="bg-gradient-to-br dark:from-white from-black from-30% dark:to-white/40 to-black/40 bg-clip-text py-6 text-5xl font-medium leading-none tracking-tighter text-transparent text-balance sm:text-6xl md:text-7xl lg:text-8xl translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:200ms]">
        Give every video a name that means something.
      </h1>
      <p className="mx-auto mb-8 max-w-3xl text-lg tracking-tight text-gray-500 md:text-xl dark:text-gray-400 text-balance translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:400ms]">
        AI Video Cataloger watches, transcribes and summarizes the videos in any
        folder - then renames them by what is actually inside. All on your Mac.
        No cloud required.
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
            <span>Download for macOS</span>
            <ArrowRightIcon className="ml-1 size-4 transition-transform duration-300 ease-in-out group-hover:translate-x-1" />
          </a>
        </Button>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          v0.1.0 early alpha - free - macOS (Apple Silicon) - .dmg, about 153 MB
        </p>
        <p className="max-w-md text-xs text-gray-600 dark:text-gray-500">
          The app is not notarized yet: on first launch, right-click the app and
          choose Open. Expect rough edges - and please report them.
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
            src="/hero-dark.png"
            alt="AI Video Cataloger app window"
            className="relative w-full h-full rounded-[inherit] border object-contain"
          />
        </div>
      </div>
    </section>
  );
}
