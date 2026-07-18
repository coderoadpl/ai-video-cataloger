import type { Dictionary } from "@/lib/i18n";

export default function HowItWorksSection({ dict }: { dict: Dictionary }) {
  return (
    <section id="how-it-works" className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-center text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl translate-y-[-1rem] animate-fade-in opacity-0">
        {dict.howItWorks.heading}
      </h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {dict.howItWorks.steps.map((step, index) => (
          <div
            key={step.title}
            className="relative overflow-hidden rounded-lg border bg-background/60 p-6 shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0"
            style={{
              animationDelay: `${120 + index * 100}ms`,
            }}
          >
            <div className="mb-6 flex size-11 items-center justify-center rounded-lg border bg-white/70 text-lg font-medium text-foreground shadow-sm dark:bg-white/10 dark:text-white">
              {index + 1}
            </div>
            <h3 className="text-xl font-medium tracking-tight">{step.title}</h3>
            <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">{step.description}</p>
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-one)] to-transparent" />
          </div>
        ))}
      </div>
    </section>
  );
}
