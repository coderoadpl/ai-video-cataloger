import Link from "next/link";

export function SiteFooter() {
  return (
    <footer>
      <div className="mx-auto flex w-full max-w-screen-xl flex-col gap-4 px-8 py-10 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between dark:text-gray-400">
        <Link href="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="" aria-hidden="true" className="h-7 w-7" />
          <span>AI Video Cataloger - built by CodeRoad</span>
        </Link>
        <span>v0.1.0 early alpha - macOS only (Apple Silicon)</span>
      </div>
    </footer>
  );
}
