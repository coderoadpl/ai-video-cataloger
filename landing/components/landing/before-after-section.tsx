import { ArrowRight } from "lucide-react";

const renames = [
  {
    oldName: "IMG_4021.mp4",
    newName: "2026-07-18_jellyfish-underwater-scene.mp4",
  },
  {
    oldName: "VID_20250612_183355.mp4",
    newName: "2026-07-18_gatekeeper-desert-dragon.mp4",
  },
  {
    oldName: "clip_final_v2.mp4",
    newName: "2026-07-18_pasta-with-tomato-sauce.mp4",
  },
];

export default function BeforeAfterSection() {
  return (
    <section className="mx-auto max-w-[80rem] px-6 py-24 md:px-8">
      <div className="mx-auto max-w-3xl text-center translate-y-[-1rem] animate-fade-in opacity-0">
        <h2 className="bg-gradient-to-br from-white from-30% to-white/40 bg-clip-text text-3xl font-medium tracking-tight text-transparent sm:text-4xl md:text-5xl">
          From camera noise to a searchable library
        </h2>
        <p className="mt-4 text-base text-gray-400 md:text-lg">
          Real output from the app - these are actual renames it produced:
        </p>
      </div>
      <div className="relative mx-auto mt-10 max-w-5xl overflow-hidden rounded-xl border border-white/10 bg-zinc-950/80 shadow-2xl shadow-black/40 backdrop-blur translate-y-[-1rem] animate-fade-in opacity-0 [--animation-delay:160ms]">
        <div className="flex h-11 items-center gap-2 border-b border-white/10 px-4">
          <span className="size-3 rounded-full bg-red-500/80" />
          <span className="size-3 rounded-full bg-yellow-400/80" />
          <span className="size-3 rounded-full bg-green-500/80" />
        </div>
        <div className="divide-y divide-white/10 font-mono text-sm">
          {renames.map((rename, index) => (
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
              <ArrowRight className="hidden size-4 shrink-0 text-gray-600 sm:block" />
              <span className="min-w-0 flex-1 break-all text-white">
                {rename.newName}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
