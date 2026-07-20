import type { Dictionary } from "@/lib/i18n";
import { Cpu, KeyRound, Layers, Mic, MessageSquare, Scale, Sparkles } from "lucide-react";

const scenarioIcons = [
  [Sparkles, MessageSquare, Cpu],
  [KeyRound, Layers, Cpu],
];

export default function RecommendationsSection({ dict }: { dict: Dictionary }) {
  return (
    <section id="recommendations" className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl">
          {dict.recommendations.heading}
        </h2>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400 md:text-lg">
          {dict.recommendations.disclaimer}
        </p>
      </div>
      <div className="mt-12 grid gap-6 lg:grid-cols-2">
        {dict.recommendations.scenarios.map((scenario, scenarioIndex) => (
          <div
            key={scenario.heading}
            className="rounded-xl border border-neutral-200 bg-white/80 p-5 shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 dark:border-white/10 dark:bg-zinc-950/70 sm:p-6"
            style={{ animationDelay: `${120 + scenarioIndex * 100}ms` }}
          >
            <h3 className="text-xl font-medium tracking-tight text-foreground">
              {scenario.heading}
            </h3>
            <div className="mt-5 space-y-4">
              {scenario.rows.map((row, rowIndex) => {
                const Icon = scenarioIcons[scenarioIndex][rowIndex];

                return (
                  <div key={row.label} className="flex items-start gap-4">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white/70 text-foreground shadow-sm dark:bg-white/10 dark:text-white">
                      <Icon className="size-5" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{row.label}</p>
                      <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {row.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-10 flex max-w-4xl items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 shadow-sm translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:420ms] dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
        <Scale className="mt-0.5 size-4 shrink-0" />
        <p>{dict.recommendations.tosCallout}</p>
      </div>
      <div className="mx-auto mt-3 flex max-w-4xl items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950 shadow-sm translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:460ms] dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-100">
        <Mic className="mt-0.5 size-4 shrink-0" />
        <p>{dict.recommendations.whisperCallout}</p>
      </div>
    </section>
  );
}
