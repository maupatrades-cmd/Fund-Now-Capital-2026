import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Global logo-confetti celebration.
 *
 * Wrap the app once (done in App.tsx):
 *   <ConfettiProvider><AppRoutes /></ConfettiProvider>
 *
 * Fire it from any component:
 *   const { celebrate, celebrateOnce } = useCelebrate();
 *   celebrate({ message: "Deal funded!" });        // confetti + success card
 *   celebrateOnce("funded:" + dealId, { message }); // fires at most once per key
 *
 * Uses the existing transparent FN mark at /public/brand-mark.png. Particles use
 * brand colours only (CLAUDE.md / SPEC S14). Silent (no sound). Respects
 * prefers-reduced-motion — the card still shows, the animation is skipped.
 */

// Brand palette (CLAUDE.md: Navy #1a3a52 · Teal #2da8b8 · Green #5dba5d) + lighter accents.
const COLORS = ["#5dba5d", "#7ac840", "#2da8b8", "#4fd1c5", "#a6e05a", "#1a3a52"];
const LOGO_SRC = "/brand-mark.png";
const ONCE_PREFIX = "fnc-celebrated:";
const CARD_AUTO_DISMISS_MS = 4000;

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  size: number;
  color: string;
  type: "logo" | "rect" | "circle";
  life: number;
};

export type CelebrateOptions = { message?: string };

type CelebrateApi = {
  celebrate: (opts?: CelebrateOptions) => void;
  /** Fire at most once per key (persisted in localStorage) — a refresh or re-visit never re-fires. */
  celebrateOnce: (key: string, opts?: CelebrateOptions) => void;
};

const noop = () => {};
const CelebrateContext = createContext<CelebrateApi>({ celebrate: noop, celebrateOnce: noop });
export const useCelebrate = (): CelebrateApi => useContext(CelebrateContext);

export function ConfettiProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const raf = useRef<number | null>(null);
  const logo = useRef<HTMLImageElement | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const [card, setCard] = useState<{ message: string } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.src = LOGO_SRC;
    img.onload = () => {
      logo.current = img;
    };
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
    };
  }, []);

  const clearCard = useCallback(() => {
    setCard(null);
    if (dismissTimer.current) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  // Escape-to-dismiss the success card (keyboard a11y).
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearCard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, clearCard]);

  const fire = useCallback(() => {
    // Respect reduced-motion: skip the animation entirely (the card still shows).
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const burst = (ox: number, oy: number) => {
      for (let i = 0; i < 70; i++) {
        const isLogo = Math.random() < 0.16;
        const ang = Math.random() * Math.PI - Math.PI / 2;
        const spd = 8 + Math.random() * 14;
        particles.current.push({
          x: ox,
          y: oy,
          vx: Math.cos(ang) * spd * (Math.random() < 0.5 ? -1 : 1),
          vy: Math.sin(ang) * spd - 6,
          rot: Math.random() * Math.PI * 2,
          vrot: (Math.random() - 0.5) * 0.3,
          size: isLogo ? 20 + Math.random() * 14 : 7 + Math.random() * 7,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          type: isLogo ? "logo" : Math.random() < 0.5 ? "rect" : "circle",
          life: 1,
        });
      }
    };
    burst(W * 0.5, H * 0.42);
    burst(W * 0.2, H * 0.5);
    burst(W * 0.8, H * 0.5);

    if (raf.current) cancelAnimationFrame(raf.current);
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      particles.current.forEach((p) => {
        p.vy += 0.35;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;
        if (p.y > H * 0.55) p.life -= 0.012;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        if (p.type === "logo" && logo.current) {
          ctx.drawImage(logo.current, -p.size / 2, -p.size / 2, p.size, p.size);
        } else if (p.type === "circle") {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        }
        ctx.restore();
      });
      particles.current = particles.current.filter((p) => p.life > 0 && p.y < H + 60);
      if (particles.current.length) raf.current = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, W, H);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  const celebrate = useCallback(
    (opts?: CelebrateOptions) => {
      if (opts?.message) {
        setCard({ message: opts.message });
        if (dismissTimer.current) window.clearTimeout(dismissTimer.current);
        // Auto-dismiss after 4s (or the user clicks / presses Escape first).
        dismissTimer.current = window.setTimeout(() => setCard(null), CARD_AUTO_DISMISS_MS);
      }
      fire();
    },
    [fire],
  );

  const celebrateOnce = useCallback(
    (key: string, opts?: CelebrateOptions) => {
      try {
        const k = ONCE_PREFIX + key;
        if (localStorage.getItem(k)) return; // already celebrated this milestone
        localStorage.setItem(k, "1");
      } catch {
        // localStorage unavailable (private mode etc.) — still celebrate; just can't dedup across reloads.
      }
      celebrate(opts);
    },
    [celebrate],
  );

  return (
    <CelebrateContext.Provider value={{ celebrate, celebrateOnce }}>
      {children}
      {/* Confetti canvas — pointer-events:none so it never blocks UI clicks. */}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 80,
        }}
      />
      {card && (
        <div
          onClick={clearCard}
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(11,42,61,.45)",
            backdropFilter: "blur(3px)",
          }}
        >
          <div
            role="status"
            aria-live="polite"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 26,
              padding: "3rem 3.5rem",
              textAlign: "center",
              maxWidth: 420,
              boxShadow: "0 40px 90px -35px rgba(11,42,61,.6)",
            }}
          >
            <div
              style={{
                width: 104,
                height: 104,
                margin: "0 auto 1.4rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "50%",
                background: "radial-gradient(circle,rgba(93,186,93,.18),transparent 70%)",
              }}
            >
              <img src={LOGO_SRC} alt="" width={86} height={86} />
            </div>
            <h2
              style={{
                margin: "0 0 .5rem",
                fontSize: "1.9rem",
                fontWeight: 800,
                letterSpacing: "-.02em",
                color: "#1a3a52",
              }}
            >
              Success! 🎉
            </h2>
            <p style={{ margin: "0 0 1.6rem", fontSize: "1rem", lineHeight: 1.55, color: "#5a7d96" }}>
              {card.message}
            </p>
            <button
              type="button"
              onClick={clearCard}
              style={{
                border: "none",
                background: "linear-gradient(135deg,#2da8b8,#1a3a52)",
                color: "#fff",
                borderRadius: 14,
                padding: ".8rem 2.25rem",
                fontSize: ".95rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </CelebrateContext.Provider>
  );
}
