import LandingPage from "@/components/landing/landing-page";
import { getDict } from "@/lib/i18n";
import type { Metadata } from "next";

const dict = getDict("en");

export const metadata: Metadata = {
  title: dict.metadata.title,
  description: dict.metadata.description,
  alternates: {
    canonical: "/",
    languages: {
      en: "/",
      pl: "/pl/",
      "x-default": "/",
    },
  },
  openGraph: {
    title: dict.metadata.title,
    description: dict.metadata.description,
    url: "/",
    siteName: "AI Video Cataloger",
    images: [{ url: "/hero-dark.png", width: 2320, height: 1624 }],
    type: "website",
    locale: "en_US",
    alternateLocale: ["pl_PL"],
  },
  twitter: {
    card: "summary_large_image",
    title: dict.metadata.title,
    description: dict.metadata.description,
    images: ["/hero-dark.png"],
  },
};

export default function Page() {
  return <LandingPage dict={dict} />;
}
