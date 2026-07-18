"use client";

import Marquee from "@/components/magicui/marquee";
import { buttonVariants } from "@/components/ui/button";
import type { Dictionary } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Bot,
  Captions,
  ChevronRight,
  FolderInput,
  LockKeyhole,
  SquareTerminal,
  Tags,
} from "lucide-react";

const tiles = [
  Tags,
  LockKeyhole,
  Captions,
  Bot,
  FolderInput,
  SquareTerminal,
];

function Tile({ icon: Icon }: { icon: (typeof tiles)[number] }) {
  return (
    <div className="relative size-20 overflow-hidden rounded-lg border bg-white p-4 shadow-sm dark:bg-transparent dark:[border:1px_solid_rgba(255,255,255,.1)] dark:[box-shadow:0_-20px_80px_-20px_#ffffff1f_inset]">
      <Icon className="size-full" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-1/2 w-1/2 -translate-x-1/2 -translate-y-1/2 overflow-visible rounded-full bg-gradient-to-r from-[#2563eb] to-[#7c3aed] opacity-40 blur-[20px] filter dark:opacity-60" />
    </div>
  );
}

export default function CallToActionSection({ dict }: { dict: Dictionary }) {
  return (
    <section id="cta">
      <div className="py-28">
        <div className="flex w-full flex-col items-center justify-center">
          <div className="relative flex w-full flex-col items-center justify-center overflow-hidden">
            <Marquee reverse className="-delay-[200ms] [--duration:24s]" repeat={5}>
              {tiles.map((icon, index) => (
                <Tile key={index} icon={icon} />
              ))}
            </Marquee>
            <Marquee reverse className="opacity-15 [--duration:34s]" repeat={5}>
              {[...tiles].reverse().map((icon, index) => (
                <Tile key={index} icon={icon} />
              ))}
            </Marquee>
            <Marquee reverse className="-delay-[200ms] opacity-15 [--duration:24s]" repeat={5}>
              {tiles.map((icon, index) => (
                <Tile key={index} icon={icon} />
              ))}
            </Marquee>
            <div className="absolute z-20 px-6 py-12">
              <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[999px] bg-background/95 blur-3xl dark:bg-background/95" />
              <div className="mx-auto size-24 rounded-[2rem] border bg-background/10 p-3 shadow-2xl backdrop-blur-md dark:bg-background/10 lg:size-32">
                <Tags className="mx-auto size-16 text-foreground dark:text-foreground lg:size-24" />
              </div>
              <div className="z-10 mt-4 flex flex-col items-center text-center text-primary">
                <h2 className="text-3xl font-bold text-balance lg:text-4xl">
                  {dict.cta.heading}
                </h2>
                <p className="mt-2">
                  {dict.cta.line}
                </p>
                <a
                  href="/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
                  download
                  className={cn(
                    buttonVariants({
                      size: "lg",
                      variant: "default",
                    }),
                    "group mt-4 rounded-lg px-8"
                  )}
                >
                  {dict.cta.button}
                  <ChevronRight className="ml-1 size-4 transition-all duration-300 ease-out group-hover:translate-x-1" />
                </a>
              </div>
              <div className="absolute inset-0 -z-10 rounded-full bg-background opacity-40 blur-xl dark:bg-background" />
            </div>
            <div className="absolute inset-x-0 bottom-0 h-full bg-gradient-to-b from-transparent to-background to-70% dark:to-background" />
          </div>
        </div>
      </div>
    </section>
  );
}
