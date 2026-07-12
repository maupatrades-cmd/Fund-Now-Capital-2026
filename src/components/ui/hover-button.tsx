import * as React from "react";
import { cn } from "@/lib/utils";

type HoverButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const HoverButton = React.forwardRef<HTMLButtonElement, HoverButtonProps>(
  ({ className, children, ...props }, ref) => {
    const [pos, setPos] = React.useState({ x: 0, y: 0 });
    const [hovered, setHovered] = React.useState(false);

    const handleMove = (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    return (
      <button
        ref={ref}
        onMouseMove={handleMove}
        onMouseEnter={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
          setHovered(true);
        }}
        onMouseLeave={() => setHovered(false)}
        className={cn(
          "relative isolate overflow-hidden rounded-lg transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -z-10 rounded-full transition-transform duration-500 ease-out"
          style={{
            left: pos.x,
            top: pos.y,
            width: 24,
            height: 24,
            marginLeft: -12,
            marginTop: -12,
            transform: hovered ? "scale(40)" : "scale(0)",
            background:
              "radial-gradient(circle, var(--circle-start, #ffffff33) 0%, var(--circle-end, transparent) 70%)",
          }}
        />
        <span className="relative flex items-center justify-center gap-2">
          {children}
        </span>
      </button>
    );
  },
);
HoverButton.displayName = "HoverButton";
