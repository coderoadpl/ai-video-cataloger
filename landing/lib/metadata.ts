import { getDict, type Locale } from "@/lib/i18n";
import type { Metadata } from "next";

export function getRootMetadata(locale: Locale): Metadata {
  const dict = getDict(locale);

  return {
    metadataBase: new URL("https://ai-video-cataloger.web.app"),
    title: dict.metadata.title,
    description: dict.metadata.description,
    openGraph: {
      title: dict.metadata.title,
      description: dict.metadata.description,
      url: locale === "pl" ? "/pl/" : "/",
      siteName: "AI Video Cataloger",
      images: [{ url: "/hero-dark.png", width: 2320, height: 1624 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dict.metadata.title,
      description: dict.metadata.description,
      images: ["/hero-dark.png"],
    },
    icons: {
      icon: "/logo.svg",
    },
  };
}
