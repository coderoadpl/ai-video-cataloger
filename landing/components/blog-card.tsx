import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";

interface BlogCardProps {
  url: string;
  title: string;
  description: string;
  date: string;
  thumbnail?: string;
  showRightBorder?: boolean;
}

export function BlogCard({
  url,
  title,
  description,
  date,
  thumbnail,
  showRightBorder = true,
}: BlogCardProps) {
  return (
    <Link
      href={url}
      className={cn(
        "group relative block border-b border-border",
        showRightBorder && "md:border-r"
      )}
    >
      <div className="flex h-full flex-col">
        {thumbnail && (
          <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-border">
            <Image
              src={thumbnail}
              alt={title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              sizes="(max-width: 768px) 100vw, 50vw"
            />
          </div>
        )}
        <div className="flex flex-1 flex-col gap-3 p-6 sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight text-card-foreground underline-offset-4 group-hover:underline sm:text-2xl">
            {title}
          </h2>
          <p className="flex-1 text-sm leading-6 text-muted-foreground sm:text-base">
            {description}
          </p>
          <time className="text-sm font-medium text-muted-foreground">
            {date}
          </time>
        </div>
      </div>
    </Link>
  );
}
