// Controlled subset of @kkkiio/pi-web-ui message.tsx (MIT), baseline a3ab3b1.
// Reasoning, tool blocks and message branches are intentionally absent.
import type { HTMLAttributes } from "react";
import { lazy, memo, Suspense } from "react";
import type { StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";

export function Message({ className, from, ...props }: HTMLAttributes<HTMLDivElement> & { from: "user" | "assistant" }) {
  return (
    <article
      className={cn("group flex w-full max-w-[94%] flex-col gap-2", from === "user" ? "is-user ml-auto items-end" : "is-assistant", className)}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "w-fit min-w-0 max-w-full text-[15px] leading-7",
        "group-[.is-user]:rounded-xl group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

const LazyMarkdown = lazy(async () => {
  const [{ Streamdown }, { cjk }] = await Promise.all([import("streamdown"), import("@streamdown/cjk")]);
  return {
    default: (props: StreamdownProps) => (
      <Streamdown {...props} controls={false} mode="static" plugins={{ ...props.plugins, cjk }} skipHtml />
    ),
  };
});

export const MessageResponse = memo(function MessageResponse({ className, children, ...props }: StreamdownProps) {
  const content = children ?? "";
  return (
    <Suspense fallback={<p aria-busy="true" className="whitespace-pre-wrap text-muted-foreground">{content}</p>}>
      <LazyMarkdown
        className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
        {...props}
      >
        {content}
      </LazyMarkdown>
    </Suspense>
  );
});
