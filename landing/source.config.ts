import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
} from "fumadocs-mdx/config";
import lastModified from "fumadocs-mdx/plugins/last-modified";
import { z } from "zod";

export default defineConfig({
  plugins: [lastModified({ versionControl: "git" })],
  mdxOptions: {
    providerImportSource: "@/mdx-components",
    // Static image imports resolve to objects only next/image can render, and this export is unoptimized.
    remarkImageOptions: false,
  },
});

export const { docs, meta } = defineDocs({
  dir: "blog/content",
  docs: {
    schema: frontmatterSchema.extend({
      description: z.string(),
      date: z.string(),
      tags: z.array(z.string()),
      featured: z.boolean().default(false),
      readTime: z.string(),
      author: z.string(),
      thumbnail: z.string(),
    }),
  },
});
