import type { Dictionary } from "@/lib/i18n";

export default function CliSection({ dict }: { dict: Dictionary }) {
  return (
    <section className="mx-auto max-w-[80rem] px-6 py-24 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-black from-30% to-black/40 bg-clip-text text-3xl font-medium tracking-tight text-transparent dark:from-white dark:to-white/40 sm:text-4xl md:text-5xl">
          {dict.cli.heading}
        </h2>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400 md:text-lg">
          {dict.cli.subline}
        </p>
      </div>
      <div className="relative mx-auto mt-10 max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/40 backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:160ms]">
        <div className="flex h-11 items-center gap-2 border-b border-white/10 px-4">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-400/80" />
          <span className="size-3 rounded-full bg-green-500/80" />
        </div>
        <pre className="overflow-x-auto p-4 text-left font-mono text-sm leading-7 text-gray-300 sm:p-6">
          {dict.cli.lines.map((line) => (
            <code key={line} className="block whitespace-pre">
              {line}
            </code>
          ))}
        </pre>
      </div>
    </section>
  );
}
