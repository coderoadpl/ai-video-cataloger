import { blogSource, formatBlogDate } from "@/lib/blog";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

interface BlogPostProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return blogSource.getPages().map((page) => ({
    slug: page.slugs[0],
  }));
}

export async function generateMetadata({
  params,
}: BlogPostProps): Promise<Metadata> {
  const { slug } = await params;
  const page = blogSource.getPage([slug]);

  if (!page) {
    return {};
  }

  return {
    title: `${page.data.title} | AI Video Cataloger`,
    description: page.data.description,
    authors: [{ name: page.data.author }],
    alternates: {
      canonical: page.url,
    },
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      type: "article",
      url: page.url,
      publishedTime: page.data.date,
      authors: [page.data.author],
      tags: page.data.tags,
      images: [
        {
          url: page.data.thumbnail,
          alt: page.data.title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: page.data.title,
      description: page.data.description,
      images: [page.data.thumbnail],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostProps) {
  const { slug } = await params;
  const page = blogSource.getPage([slug]);

  if (!page) {
    notFound();
  }

  const MDXContent = page.data.body;

  return (
    <article className="bg-background">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-screen-xl px-8 py-12 sm:py-16">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            All articles
          </Link>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            {page.data.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md border border-border bg-muted px-2.5 py-1 font-medium"
              >
                {tag}
              </span>
            ))}
            <time dateTime={page.data.date}>
              {formatBlogDate(page.data.date)}
            </time>
            <span>{page.data.readTime}</span>
          </div>
          <h1 className="mt-6 max-w-5xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            {page.data.title}
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
            {page.data.description}
          </p>
          <p className="mt-5 text-sm font-medium text-muted-foreground">
            By {page.data.author}
          </p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-screen-xl px-8 py-10 sm:py-16">
        <div className="relative aspect-[16/10] overflow-hidden rounded-lg border border-border bg-muted">
          <Image
            src={page.data.thumbnail}
            alt={page.data.title}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1280px) 100vw, 1280px"
          />
        </div>
        <div className="blog-prose prose prose-lg mx-auto mt-12 max-w-3xl">
          <MDXContent />
        </div>
      </div>
    </article>
  );
}
