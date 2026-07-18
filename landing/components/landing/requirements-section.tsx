import type { Dictionary } from "@/lib/i18n";
import { AlertTriangle, Cloud, Cpu, HardDrive, Info } from "lucide-react";

export default function RequirementsSection({ dict }: { dict: Dictionary }) {
  const maxSizeMb = Math.max(
    ...dict.requirements.diskItems.map((item) => item.sizeMb)
  );

  return (
    <section id="requirements" className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl">
          {dict.requirements.heading}
        </h2>
      </div>
      <div className="mx-auto mt-8 max-w-4xl rounded-xl bg-gradient-to-r from-[var(--color-one)] via-[#7c3aed] to-[var(--color-two)] p-px shadow-lg shadow-blue-500/10 translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:100ms]">
        <div className="rounded-[11px] bg-blue-50/95 p-5 backdrop-blur dark:bg-zinc-950/90 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-white text-blue-700 shadow-sm dark:bg-white/10 dark:text-blue-200">
              <Cloud className="size-5" />
            </div>
            <div>
              <h3 className="text-xl font-medium tracking-tight text-foreground">
                {dict.requirements.cloudCallout.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-gray-700 dark:text-gray-300">
                {dict.requirements.cloudCallout.body}
              </p>
            </div>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-center text-sm font-medium text-gray-600 translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:180ms] dark:text-gray-400">
        {dict.requirements.baseline}
      </p>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {dict.requirements.tiers.map((tier, index) => (
          <div
            key={tier.size}
            className={`relative overflow-hidden rounded-lg shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 ${
              index === 1
                ? "border border-transparent bg-gradient-to-r from-[var(--color-one)] to-[var(--color-two)] p-px shadow-lg shadow-blue-500/10"
                : "border bg-background/60 p-6"
            }`}
            style={{
              animationDelay: `${120 + index * 100}ms`,
            }}
          >
            <div
              className={
                index === 1
                  ? "rounded-[7px] bg-background/95 p-6 backdrop-blur dark:bg-zinc-950/90"
                  : ""
              }
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-11 items-center justify-center rounded-lg border bg-white/70 text-foreground shadow-sm dark:bg-white/10 dark:text-white">
                  <Cpu className="size-5" />
                </div>
                <span
                  className={
                    index === 1
                      ? "rounded-full bg-gradient-to-r from-[#2563eb] to-[#7c3aed] px-2.5 py-1 text-xs font-medium text-white shadow-sm shadow-blue-500/20"
                      : "rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200"
                  }
                >
                  {tier.badge}
                </span>
              </div>
              <h3 className="mt-6 text-3xl font-medium tracking-tight">
                {tier.size}
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {tier.description}
              </p>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-one)] to-transparent" />
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-5 flex max-w-3xl items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 shadow-sm translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:420ms] dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>{dict.requirements.warning}</p>
      </div>
      <div className="mx-auto mt-3 flex max-w-3xl items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 shadow-sm translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:460ms] dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>{dict.requirements.memoryNote}</p>
      </div>
      <div className="mx-auto mt-10 max-w-4xl rounded-xl border border-neutral-200 bg-white/80 p-5 shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:520ms] dark:border-white/10 dark:bg-zinc-950/70">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg border bg-white text-foreground shadow-sm dark:bg-white/10 dark:text-white">
            <HardDrive className="size-5" />
          </div>
          <h3 className="text-xl font-medium tracking-tight">
            {dict.requirements.diskHeading}
          </h3>
        </div>
        <div className="space-y-5">
          {dict.requirements.diskItems.map((item) => {
            const width = Math.max(8, (item.sizeMb / maxSizeMb) * 100);

            return (
              <div key={item.label}>
                <div className="mb-2 flex items-baseline justify-between gap-4 text-sm">
                  <span className="font-medium text-foreground">
                    {item.label}
                  </span>
                  <span className="shrink-0 text-gray-500 dark:text-gray-400">
                    {item.size}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full border border-neutral-200 bg-neutral-100 dark:border-white/10 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#2563eb] to-[#7c3aed]"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="mx-auto mt-5 max-w-3xl text-center text-sm leading-6 text-gray-500 translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:620ms] dark:text-gray-400">
        {dict.requirements.closing}
      </p>
    </section>
  );
}
