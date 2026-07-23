// Adapted from @kkkiio/pi-web-ui sources.tsx (MIT), baseline a3ab3b1.
import { BookOpenText, CaretDown } from "@phosphor-icons/react";
import type { ComponentProps } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Sources({ className, ...props }: ComponentProps<typeof Collapsible>) {
  return <Collapsible className={cn("mt-4 text-sm", className)} {...props} />;
}

export function SourcesTrigger({ count, className, ...props }: ComponentProps<typeof CollapsibleTrigger> & { count: number }) {
  return (
    <CollapsibleTrigger className={cn("flex items-center gap-2 font-medium text-primary", className)} {...props}>
      <BookOpenText aria-hidden size={18} />
      <span>数据来源（{count}）</span>
      <CaretDown aria-hidden size={15} />
    </CollapsibleTrigger>
  );
}

export function SourcesContent({ className, ...props }: ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent className={cn("mt-3 grid gap-2", className)} {...props} />;
}

export function SourceLink({ className, ...props }: ComponentProps<"a">) {
  return <a className={cn("flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm no-underline hover:bg-secondary", className)} rel="noreferrer" target="_blank" {...props} />;
}

