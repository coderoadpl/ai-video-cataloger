const steps = [
  {
    title: "Point it at a folder",
    description: "Pick any folder of videos. Nothing is uploaded and nothing is moved.",
  },
  {
    title: "AI watches and listens",
    description:
      "Frames are sampled, speech is transcribed with Whisper, and your chosen AI writes a summary and tags.",
  },
  {
    title: "Named and searchable",
    description:
      "Every file gets a content-based name and lands in a catalog you can browse and search.",
  },
];

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="mx-auto max-w-[80rem] px-6 py-24 md:px-8">
      <h2 className="bg-gradient-to-br from-white from-30% to-white/40 bg-clip-text text-center text-3xl font-medium tracking-tight text-transparent sm:text-4xl md:text-5xl translate-y-[-1rem] animate-fade-in opacity-0">
        How it works
      </h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <div
            key={step.title}
            className="relative overflow-hidden rounded-lg border bg-background/60 p-6 shadow-sm backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0"
            style={{
              animationDelay: `${120 + index * 100}ms`,
            }}
          >
            <div className="mb-6 flex size-11 items-center justify-center rounded-lg border bg-white/10 text-lg font-medium text-white shadow-sm">
              {index + 1}
            </div>
            <h3 className="text-xl font-medium tracking-tight">{step.title}</h3>
            <p className="mt-3 text-sm leading-6 text-gray-400">{step.description}</p>
            <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-one)] to-transparent" />
          </div>
        ))}
      </div>
    </section>
  );
}
