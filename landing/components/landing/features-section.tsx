import type { Dictionary } from "@/lib/i18n";
import {
  Bot,
  Captions,
  FolderInput,
  LockKeyhole,
  SquareTerminal,
  Tags,
} from "lucide-react";

const icons = [
  Tags,
  LockKeyhole,
  Captions,
  Bot,
  FolderInput,
  SquareTerminal,
];

export default function FeaturesSection({ dict }: { dict: Dictionary }) {
  return (
    <section id="features" className="mx-auto max-w-[80rem] px-6 py-28 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-black from-30% to-gray-600 bg-clip-text text-3xl font-medium tracking-tight text-transparent text-balance dark:from-white dark:to-white/70 sm:text-4xl md:text-5xl">
          {dict.features.heading}
        </h2>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400 md:text-lg">
          {dict.features.subheading}
        </p>
      </div>
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {dict.features.items.map((feature, index) => {
          const Icon = icons[index];

          return (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-lg border bg-background/60 p-6 shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0"
              style={{
                animationDelay: `${120 + index * 80}ms`,
              }}
            >
              <div className="mb-5 flex size-11 items-center justify-center rounded-lg border bg-white/70 text-foreground shadow-sm dark:bg-white/10">
                <Icon className="size-5" />
              </div>
              <h3 className="text-xl font-medium tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {feature.description}
              </p>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-two)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
            </div>
          );
        })}
      </div>
    </section>
  );
}
