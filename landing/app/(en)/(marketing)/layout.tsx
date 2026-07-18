import { SiteFooter } from "@/components/site-footer";
import { SiteBanner } from "@/components/site-banner";
import { SiteHeader } from "@/components/site-header";
import { LangBanner } from "@/components/lang-banner";
import { getDict } from "@/lib/i18n";

interface MarketingLayoutProps {
  children: React.ReactNode;
}

export default async function MarketingLayout({
  children,
}: MarketingLayoutProps) {
  const dict = getDict("en");

  return (
    <>
      <SiteBanner dict={dict} />
      <LangBanner />
      <SiteHeader dict={dict} />
      <main className="mx-auto flex-1 overflow-hidden">{children}</main>
      <SiteFooter dict={dict} />
    </>
  );
}
