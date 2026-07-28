import { BlogCard } from "@/components/blog-card";
import { blogSource, formatBlogDate } from "@/lib/blog";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog | AI Video Cataloger",
  description:
    "Product guides, experiments, and notes from the AI Video Cataloger team.",
  alternates: {
    canonical: "/blog/",
  },
};

export default function BlogPage() {
  const posts = blogSource.getPages().sort((left, right) => {
    return (
      new Date(right.data.date).getTime() - new Date(left.data.date).getTime()
    );
  });

  return (
    <section className="min-h-[70vh] bg-background">
      <div className="border-b border-border">
        <div className="mx-auto w-full max-w-screen-xl px-8 py-16 sm:py-24">
          <p className="text-sm font-medium text-muted-foreground">
            AI Video Cataloger
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">
            Blog
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Product guides, experiments, and notes from the AI Video Cataloger
            team.
          </p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-screen-xl px-8 pb-16 sm:pb-24">
        <div className="grid border-x border-border md:grid-cols-2">
          {posts.map((post, index) => (
            <BlogCard
              key={post.url}
              url={post.url}
              title={post.data.title}
              description={post.data.description}
              date={formatBlogDate(post.data.date)}
              thumbnail={post.data.thumbnail}
              showRightBorder={index % 2 === 0}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
