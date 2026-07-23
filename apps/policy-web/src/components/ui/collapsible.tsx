// Adapted from @kkkiio/pi-web-ui 0.1.1 (MIT), baseline a3ab3b1.
import { Collapsible as Primitive } from "radix-ui";
import type * as React from "react";

export function Collapsible(props: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger(props: React.ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

export function CollapsibleContent(props: React.ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content data-slot="collapsible-content" {...props} />;
}

