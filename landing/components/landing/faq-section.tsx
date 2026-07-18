const questions = [
  {
    question: "Is my footage private?",
    answer:
      "With local models - the default - everything runs on your Mac: frames, audio, transcripts and summaries never leave your machine. If you connect an OpenAI-compatible API or an agent CLI, only the analysis step goes through that provider, with your key and by your explicit choice. No telemetry by default.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "An Apple Silicon Mac. The setup wizard handles the rest on first launch: it installs a local AI runtime (Ollama) and Whisper, and ffmpeg is bundled with the app.",
  },
  {
    question: "How much disk space do local models take?",
    answer:
      "Whisper models range from about 75 MB to 1.5 GB; local analysis models via Ollama are typically 2-8 GB. You choose what to install in the wizard.",
  },
  {
    question: "Does it work offline?",
    answer:
      "Yes - with local models the whole pipeline is offline. API and agent-CLI backends need network.",
  },
  {
    question: "Does it change my files?",
    answer:
      "It renames videos to the content-based name and keeps the original name in its catalog, stored in a hidden .ai-video-cataloger folder inside your folder. Nothing is uploaded and nothing is deleted.",
  },
  {
    question: "Is it really free?",
    answer:
      "The alpha is free. Local analysis costs nothing; if you bring an API key, your provider bills your usage.",
  },
];

export default function FaqSection() {
  return (
    <section id="faq" className="mx-auto max-w-[80rem] px-6 py-24 md:px-8">
      <h2 className="bg-gradient-to-br from-white from-30% to-white/40 bg-clip-text text-center text-3xl font-medium tracking-tight text-transparent sm:text-4xl md:text-5xl translate-y-[-1rem] animate-fade-in opacity-0">
        Questions, answered
      </h2>
      <div className="mx-auto mt-10 max-w-3xl divide-y divide-white/10 rounded-xl border border-white/10 bg-background/60 backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:160ms]">
        {questions.map((item) => (
          <details key={item.question} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium tracking-tight text-white">
              {item.question}
              <span className="text-xl leading-none text-gray-500 transition-transform duration-300 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-6 text-gray-400">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
