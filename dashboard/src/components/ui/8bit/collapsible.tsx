"use client";

import { Collapsible as CollapsiblePrimitive } from "radix-ui";

const ShadcnCollapsible = CollapsiblePrimitive.Root;
const ShadcnCollapsibleContent = CollapsiblePrimitive.Content;
const ShadcnCollapsibleTrigger = CollapsiblePrimitive.Trigger;

import { cn } from "@/lib/utils";

import "@/components/ui/8bit/styles/retro.css";

export interface BitCollapsibleProps
  extends React.ComponentProps<typeof CollapsiblePrimitive.Root> {
  asChild?: boolean;
}

function Collapsible({ children, ...props }: BitCollapsibleProps) {
  const { className } = props;

  return (
    <div className={cn("relative", className)}>
      <ShadcnCollapsible {...props} className={cn(className, "retro")}>
        {children}
      </ShadcnCollapsible>
    </div>
  );
}

function CollapsibleTrigger({
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  const { className } = props;
  return (
    <ShadcnCollapsibleTrigger
      data-slot="collapsible-trigger"
      className={cn(className, "retro")}
      {...props}
    >
      {children}
    </ShadcnCollapsibleTrigger>
  );
}

function CollapsibleContent({
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  const { className } = props;
  return (
    <ShadcnCollapsibleContent
      data-slot="collapsible-content"
      className={cn(className, "retro")}
      {...props}
    >
      {children}
    </ShadcnCollapsibleContent>
  );
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
