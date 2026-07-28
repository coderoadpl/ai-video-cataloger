import {
  defineConfig,
  defineDocs,
  frontmatterSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";

export default defineConfig({
  lastModifiedTime: "git",
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
