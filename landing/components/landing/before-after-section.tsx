import type { Dictionary } from "@/lib/i18n";
import { ArrowRight } from "lucide-react";

export default function BeforeAfterSection({ dict }: { dict: Dictionary }) {
  return (
    <section className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl">
          {dict.beforeAfter.heading}
        </h2>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400 md:text-lg">
          {dict.beforeAfter.subline}
        </p>
      </div>
      <div className="relative mx-auto mt-10 max-w-5xl overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl shadow-neutral-200/70 backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:160ms] dark:border-white/10 dark:bg-zinc-950/80 dark:shadow-black/40">
        <div className="flex h-11 items-center gap-2 border-b border-neutral-200 px-4 dark:border-white/10">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-400/80" />
          <span className="size-3 rounded-full bg-green-500/80" />
        </div>
        <div className="divide-y divide-neutral-200 font-mono text-sm dark:divide-white/10">
          {dict.beforeAfter.renames.map((rename, index) => (
            <div
              key={rename.oldName}
              className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:px-6"
              style={{
                animationDelay: `${260 + index * 90}ms`,
              }}
            >
              <span className="min-w-0 flex-1 break-all text-gray-500">
                {rename.oldName}
              </span>
              <ArrowRight className="hidden size-4 shrink-0 text-blue-600 sm:block dark:text-blue-400" />
              <span className="min-w-0 flex-1 break-all text-neutral-950 dark:text-white">
                {rename.newName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
