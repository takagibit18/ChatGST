// Controlled subset of @kkkiio/pi-web-ui conversation.tsx (MIT), baseline a3ab3b1.
import { ArrowDown } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { useCallback } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Conversation({ className, ...props }: ComponentProps<typeof StickToBottom>) {
  return <StickToBottom className={cn("relative min-h-0 flex-1 overflow-y-hidden", className)} initial="smooth" role="log" {...props} />;
}

export function ConversationContent({ className, ...props }: ComponentProps<typeof StickToBottom.Content>) {
  return <StickToBottom.Content className={cn("mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6", className)} {...props} />;
}

type EmptyStateProps = ComponentProps<"div"> & { title: string; description: string; icon?: ReactNode };

export function ConversationEmptyState({ title, description, icon, className, children, ...props }: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-80 flex-col items-start justify-center gap-4 py-10", className)} {...props}>
      {icon ? <div className="grid size-12 place-items-center rounded-xl bg-secondary text-primary">{icon}</div> : null}
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function ConversationScrollButton({ className, ...props }: ComponentProps<typeof Button>) {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const handleClick = useCallback(() => scrollToBottom(), [scrollToBottom]);
  if (isAtBottom) return null;
  return (
    <Button
      aria-label="滚动到最新消息"
      className={cn("absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md", className)}
      onClick={handleClick}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <ArrowDown aria-hidden size={18} weight="bold" />
    </Button>
  );
}

