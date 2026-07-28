import { docs, meta } from "@/.source";
import { loader } from "fumadocs-core/source";
import { createMDXSource } from "fumadocs-mdx";

export const blogSource = loader({
  baseUrl: "/blog",
  source: createMDXSource(docs, meta),
});

export function formatBlogDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
