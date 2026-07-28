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
