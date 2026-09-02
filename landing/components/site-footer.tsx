import Link from "next/link";
import type { Dictionary } from "@/lib/i18n";

export function SiteFooter({ dict }: { dict: Dictionary }) {
  const homeHref = dict.locale === "en" ? "/" : "/pl/";
  const feedbackEmail = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL ?? "feedback@example.com";

  return (
    <footer className="border-t border-neutral-200 dark:border-white/10">
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-8 py-12 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between dark:text-gray-400">
        <Link href={homeHref} className="flex items-center gap-2">
          <img src="/logo.svg" alt="" aria-hidden="true" className="h-7 w-7" />
          <span>{dict.footer.builtBy}</span>
        </Link>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <span>{dict.footer.version}</span>
          <a
            href={`mailto:${feedbackEmail}?subject=AI%20Video%20Cataloger%20feedback`}
            className="text-gray-800 underline underline-offset-4 transition-colors hover:text-black dark:text-gray-300 dark:hover:text-white"
          >
            {dict.footer.feedback}
          </a>
        </div>
      </div>
    </footer>
  );
}
