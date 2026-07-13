import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import "./AuthPage.css";

const MARK_SRC = "/brand-mark.png";

type Phase = "brand" | "textIn" | "content";

type ParticleStyle = CSSProperties;

// Login form is validated with zod (locked stack: react-hook-form + zod).
// This is login-only — there is no signup schema and no signUp call anywhere.
const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Business email is required")
    .email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean().optional(),
});

type LoginValues = z.infer<typeof loginSchema>;

// Drifting background particles on the navy panel (26 dots, teal/green/soft-white).
function useParticles(): ParticleStyle[] {
  return useMemo(() => {
    const colors = ["#2da8b8", "#5dba5d", "rgba(255,255,255,0.7)"];
    return Array.from({ length: 26 }).map(() => {
      const size = 1 + Math.random() * 3;
      const dur = 8 + Math.random() * 12;
      return {
        left: `${Math.random() * 100}%`,
        top: `${Math.random() * 100}%`,
        width: `${size}px`,
        height: `${size}px`,
        background: colors[Math.floor(Math.random() * colors.length)],
        animationDuration: `${dur}s`,
        animationDelay: `${-Math.random() * dur}s`,
      } satisfies ParticleStyle;
    });
  }, []);
}

// Canvas "vaporize" intro: draws the brand lockup, then dissolves it into
// particles left→right before handing off to the clean DOM lockup.
function useVaporizeIntro(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  setPhase: (p: Phase) => void,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setPhase("content");
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setPhase("content");
      return;
    }

    let stopped = false;
    let raf = 0;
    let sweepTimer: ReturnType<typeof setTimeout> | undefined;
    let contentTimer: ReturnType<typeof setTimeout> | undefined;

    const W = canvas.width;
    const H = canvas.height;

    const drawLockup = () => {
      const img = new Image();
      img.onload = () => {
        if (stopped) return;
        ctx.clearRect(0, 0, W, H);
        const dh = 104;
        const dw = dh * (img.width / img.height);
        const gap = 24;
        ctx.textBaseline = "alphabetic";
        ctx.font = "700 36px Inter, sans-serif";
        const t1 = "Fund Now ";
        const t2 = "Capital";
        const wTitle = ctx.measureText(t1).width + ctx.measureText(t2).width;
        const total = dw + gap + wTitle;
        const x0 = (W - total) / 2;
        const cy = H / 2;
        ctx.drawImage(img, x0, cy - dh / 2, dw, dh);
        const tx = x0 + dw + gap;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(t1, tx, cy - 2);
        ctx.fillStyle = "#2da8b8";
        ctx.fillText(t2, tx + ctx.measureText(t1).width, cy - 2);
        ctx.font = "500 16px Inter, sans-serif";
        ctx.fillStyle = "#7fc9d4";
        ctx.fillText("Many funders. More Approvals.", tx, cy + 24);
        sampleAndSchedule();
      };
      img.src = MARK_SRC;
    };

    type P = {
      x: number;
      y: number;
      px: number;
      py: number;
      active: boolean;
      alpha: number;
      vx: number;
      vy: number;
      color: string;
    };

    const sampleAndSchedule = () => {
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      const particles: P[] = [];
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const i = (y * W + x) * 4;
          const a = data[i + 3];
          if (a > 30) {
            particles.push({
              x,
              y,
              px: x,
              py: y,
              active: false,
              alpha: 1,
              vx: 0,
              vy: 0,
              color: `rgba(${data[i]},${data[i + 1]},${data[i + 2]},`,
            });
          }
        }
      }
      sweepTimer = setTimeout(() => runSweep(particles), 2500);
    };

    const runSweep = (particles: P[]) => {
      let sweepX = 0;
      const step = () => {
        if (stopped) return;
        ctx.clearRect(0, 0, W, H);
        sweepX += 5;
        let anyAlive = false;
        for (const p of particles) {
          if (!p.active && sweepX >= p.x) {
            p.active = true;
            p.vx = (Math.random() - 0.15) * 10;
            p.vy = (Math.random() - 0.5) * 9;
          }
          if (!p.active) {
            ctx.fillStyle = p.color + "1)";
            ctx.fillRect(p.x, p.y, 2, 2);
            anyAlive = true;
          } else if (p.alpha > 0) {
            p.px += p.vx;
            p.py += p.vy;
            p.vx *= 0.965;
            p.vy *= 0.965;
            p.alpha -= 0.006;
            if (p.alpha > 0) {
              ctx.fillStyle = p.color + p.alpha + ")";
              ctx.fillRect(p.px, p.py, 2, 2);
              anyAlive = true;
            }
          }
        }
        if (anyAlive || sweepX < W + 50) {
          raf = requestAnimationFrame(step);
        } else {
          ctx.clearRect(0, 0, W, H);
          setPhase("textIn");
          contentTimer = setTimeout(() => {
            if (stopped) return;
            setPhase("content");
          }, 1200);
        }
      };
      raf = requestAnimationFrame(step);
    };

    // Wait for Inter so the canvas wordmark matches the DOM lockup that fades in.
    const fontsReady =
      "fonts" in document
        ? Promise.all([
            document.fonts.load("700 36px Inter"),
            document.fonts.load("500 16px Inter"),
          ]).catch(() => undefined)
        : Promise.resolve();

    fontsReady.then(() => {
      if (!stopped) drawLockup();
    });

    return () => {
      stopped = true;
      if (raf) cancelAnimationFrame(raf);
      if (sweepTimer) clearTimeout(sweepTimer);
      if (contentTimer) clearTimeout(contentTimer);
    };
  }, [canvasRef, setPhase]);
}

const BadgeCheck = () => (
  <span className="badge-check">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 6L9 17L4 12"
        stroke="#fff"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export default function AuthPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("brand");
  const [pwVisible, setPwVisible] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const navigate = useNavigate();

  const particles = useParticles();
  useVaporizeIntro(canvasRef, setPhase);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", remember: false },
  });

  const brandIn = phase === "textIn" || phase === "content";
  const contentIn = phase === "content";

  const onSubmit = async (values: LoginValues) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) {
      // Show the real Supabase error (e.g. "Invalid login credentials").
      setAuthError(error.message);
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  return (
    <div className="fnc-login">
      {/* Left brand panel */}
      <div className="left">
        <div className="shimmer" />
        <div className="orb orb-teal" />
        <div className="orb orb-green" />
        {particles.map((style, i) => (
          <div key={i} className="particle" style={style} />
        ))}

        <div className="brand-stage">
          <canvas
            ref={canvasRef}
            className="brand-canvas"
            width={640}
            height={180}
          />
          <div className={"brand-replay" + (brandIn ? " in" : "")}>
            <img
              className="replay-mark"
              src={MARK_SRC}
              alt="Fund Now Capital"
            />
            <div className="replay-text">
              <div className="brand-title">
                Fund Now <span className="brand-cap">Capital</span>
              </div>
              <div className="brand-tag">Many funders. More Approvals.</div>
            </div>
          </div>
        </div>

        <div className={"hero-block" + (contentIn ? " in" : "")}>
          <h1 className="hero">
            Your engine. Your empire.
            <br />
            <span className="hero-grad">Built deal by deal.</span>
          </h1>
          <p className="hero-desc">
            From pipeline to payday — all in one place.
          </p>
          <div className="badges">
            <div className="badge-row">
              <BadgeCheck />
              Trusted SME funding partner
            </div>
            <div className="badge-row">
              <BadgeCheck />
              Fast, transparent process
            </div>
            <div className="badge-row">
              <BadgeCheck />
              Secure and confidential
            </div>
          </div>
        </div>

        <div className="left-footer">© 2026 Fund Now Capital (Pty) Ltd</div>
      </div>

      {/* Right form panel */}
      <div className="right">
        <form
          className="form-wrap"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
        >
          <img className="mobile-badge" src={MARK_SRC} alt="Fund Now Capital" />
          <h2 className="welcome">Welcome back</h2>
          <p className="subtext">Sign in to continue to your dashboard</p>

          {authError && (
            <div className="auth-error" role="alert">
              {authError}
            </div>
          )}

          <div className="field">
            <div className="field-label">
              <label className="flabel" htmlFor="email">
                Business email
              </label>
            </div>
            <div className="input-wrap">
              <span className="input-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </span>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                placeholder="you@fundnowcapital.africa"
                aria-invalid={errors.email ? "true" : "false"}
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="field-error">{errors.email.message}</p>
            )}
          </div>

          <div className="field">
            <div className="field-label">
              <label className="flabel" htmlFor="password">
                Password
              </label>
              <button
                type="button"
                className="forgot"
                onClick={() => toast("Password reset coming soon")}
              >
                Forgot?
              </button>
            </div>
            <div className="input-wrap">
              <span className="input-icon">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </span>
              <input
                id="password"
                className={"input pw" + (pwVisible ? " revealed" : "")}
                type={pwVisible ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                aria-invalid={errors.password ? "true" : "false"}
                {...register("password")}
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setPwVisible((v) => !v)}
                aria-label={pwVisible ? "Hide password" : "Show password"}
                aria-pressed={pwVisible}
              >
                {pwVisible ? (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                ) : (
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-6.5 0-10-8-10-8a18.7 18.7 0 0 1 4.22-5.19M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                )}
              </button>
            </div>
            {errors.password && (
              <p className="field-error">{errors.password.message}</p>
            )}
          </div>

          <div className="remember-row">
            <input
              className="checkbox"
              type="checkbox"
              id="remember"
              {...register("remember")}
            />
            <label htmlFor="remember">Remember me for 30 days</label>
          </div>

          <button className="signin-btn" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign In"}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fff"
              strokeWidth="2"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>

          <div className="divider">SECURED BY</div>
          <div className="secure-row">
            <div className="secure-item">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z" />
              </svg>
              RLS Protected
            </div>
            <div className="secure-item">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              End-to-End Encrypted
            </div>
          </div>

          <div className="foot-links">
            <a onClick={(e) => e.preventDefault()} href="#">
              Privacy Policy
            </a>
            <a onClick={(e) => e.preventDefault()} href="#">
              Terms of Service
            </a>
            <a onClick={(e) => e.preventDefault()} href="#">
              Contact Support
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
