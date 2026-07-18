import { RootShell } from "@/app/root-shell";
import { SiteBanner } from "@/components/site-banner";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getDict } from "@/lib/i18n";
import { getRootMetadata } from "@/lib/metadata";

export const metadata = getRootMetadata("pl");

interface PolishLayoutProps {
  children: React.ReactNode;
}

export default function PolishLayout({ children }: PolishLayoutProps) {
  const dict = getDict("pl");

  return (
    <RootShell lang="pl">
      <SiteBanner dict={dict} />
      <SiteHeader dict={dict} />
      <main className="mx-auto flex-1 overflow-hidden">{children}</main>
      <SiteFooter dict={dict} />
    </RootShell>
  );
}
