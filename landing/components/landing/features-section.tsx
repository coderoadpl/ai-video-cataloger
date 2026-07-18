import {
  Bot,
  Captions,
  FolderInput,
  LockKeyhole,
  SquareTerminal,
  Tags,
} from "lucide-react";

const features = [
  {
    title: "Names with meaning",
    description:
      "IMG_4021.mp4 becomes jellyfish-underwater-scene.mp4. Filenames are written from what the AI actually sees and hears.",
    icon: Tags,
  },
  {
    title: "Local-first privacy",
    description:
      "Runs entirely on your Mac with local models via Ollama. Nothing leaves your machine unless you opt into an API.",
    icon: LockKeyhole,
  },
  {
    title: "Whisper transcription",
    description:
      "Every spoken word becomes searchable text, transcribed on-device with Whisper.",
    icon: Captions,
  },
  {
    title: "Bring your own AI",
    description:
      "Local models, any OpenAI-compatible API with your key, or the agent CLIs you already use: Claude Code, Codex, Cursor.",
    icon: Bot,
  },
  {
    title: "One-click batches",
    description:
      "Point at a folder and press one button: frames, audio, transcript, summary and rename for every video in it.",
    icon: FolderInput,
  },
  {
    title: "GUI and CLI",
    description:
      "A clean desktop app plus a first-class CLI with JSON output for scripts and automation.",
    icon: SquareTerminal,
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" className="mx-auto max-w-[80rem] px-6 py-24 md:px-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {features.map((feature, index) => {
          const Icon = feature.icon;

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
              <h2 className="text-xl font-medium tracking-tight">
                {feature.title}
              </h2>
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
