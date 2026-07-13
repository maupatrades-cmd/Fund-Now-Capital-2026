import * as React from "react";
import { MovingBorder } from "@/components/ui/moving-border";

// The single sanctioned glow effect for the app: a brand teal→green moving
// border. Used to highlight priority deals (wired up in the Pipeline screen).
// Thin wrapper over MovingBorder with the agreed brand settings baked in.
export function PriorityGlow({
  children,
  className,
  outerClassName,
}: {
  children: React.ReactNode;
  className?: string;
  outerClassName?: string;
}) {
  return (
    <MovingBorder
      radius={12}
      borderWidth={2}
      gradientWidth={60}
      duration={4}
      colors={["#2da8b8", "#5dba5d", "#2da8b8"]}
      className={className}
      outerClassName={outerClassName}
    >
      {children}
    </MovingBorder>
  );
}
