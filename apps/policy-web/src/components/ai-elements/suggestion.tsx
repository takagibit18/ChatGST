// Adapted from @kkkiio/pi-web-ui suggestion.tsx (MIT), baseline a3ab3b1.
import type { ComponentProps } from "react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Suggestions({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-wrap gap-2", className)} {...props} />;
}

type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick" | "onSelect"> & {
  value: string;
  onSelect: (value: string) => void;
};

export function Suggestion({ value, onSelect, className, children, ...props }: SuggestionProps) {
  const handleClick = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button className={cn("rounded-full", className)} onClick={handleClick} size="sm" type="button" variant="outline" {...props}>
      {children ?? value}
    </Button>
  );
}
