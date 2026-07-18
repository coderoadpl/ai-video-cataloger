import { RootShell } from "@/app/root-shell";
import { getRootMetadata } from "@/lib/metadata";

export const metadata = getRootMetadata("en");

export default function EnglishRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <RootShell lang="en">{children}</RootShell>;
}
