import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";

export function SiteBanner({ dict }: { dict: Dictionary }) {
  return (
    <div className="relative bg-gradient-to-r from-[#2563eb] to-[#7c3aed] text-white py-3 md:py-0">
      <div className="container flex flex-col items-center justify-center gap-4 md:h-12 md:flex-row">
        <Link
          href="/downloads/AI-Video-Cataloger-0.1.0-arm64.dmg"
          download
          className="text-center text-sm leading-loose text-muted-background"
        >
          <span className="font-bold">{dict.siteBanner.text}</span>
        </Link>
      </div>
      <hr className="absolute bottom-0 m-0 h-px w-full bg-neutral-200/30" />
    </div>
  );
}
