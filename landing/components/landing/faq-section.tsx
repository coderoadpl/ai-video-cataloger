import type { Dictionary } from "@/lib/i18n";

export default function FaqSection({ dict }: { dict: Dictionary }) {
  return (
    <section id="faq" className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-center text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl translate-y-[-1rem] animate-fade-in opacity-0">
        {dict.faq.heading}
      </h2>
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-black/10 rounded-xl border border-black/10 bg-background/60 backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:160ms] dark:divide-white/10 dark:border-white/10">
        {dict.faq.items.map((item) => (
          <details key={item.question} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium tracking-tight text-foreground dark:text-white">
              {item.question}
              <span className="text-xl leading-none text-gray-500 transition-transform duration-300 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
