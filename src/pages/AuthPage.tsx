import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Eye, EyeOff, Lock, User } from "lucide-react";
import { toast } from "sonner";
import VaporizeTextCycle, { Tag } from "@/components/ui/vapour-text-effect";
import { HoverButton } from "@/components/ui/hover-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const VAPOR_TEXTS = ["Fund Now Capital", "Many funders.", "More approvals."];

export default function AuthPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [vaporFontSize, setVaporFontSize] = useState("56px");

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 640px)");
    const update = () => setVaporFontSize(mql.matches ? "32px" : "56px");
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    toast("Auth wiring coming in the next step");
  };

  const signInStyle = {
    "--circle-start": "#5dba5d",
    "--circle-end": "#2da8b8",
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="h-24 sm:h-32 mb-6 sm:mb-8">
          <VaporizeTextCycle
            texts={VAPOR_TEXTS}
            font={{
              fontFamily: "Inter, sans-serif",
              fontSize: vaporFontSize,
              fontWeight: 600,
            }}
            color="rgb(26, 58, 82)"
            spread={5}
            density={5}
            animation={{
              vaporizeDuration: 2,
              fadeInDuration: 1,
              waitDuration: 0.5,
            }}
            direction="left-to-right"
            alignment="center"
            tag={Tag.H1}
          />
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 w-full">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-brand-navy flex items-center justify-center">
              <span className="text-white font-bold text-lg tracking-wide">FN</span>
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-brand-navy">
              Secure Access
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fund Now Capital CRM
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email" className="sr-only">
                Email
              </Label>
              <div className="relative">
                <User
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="Email"
                  required
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <a
                href="#"
                onClick={(e) => e.preventDefault()}
                className="text-sm text-brand-teal hover:underline"
              >
                Forgot password?
              </a>
            </div>

            <div>
              <Label htmlFor="password" className="sr-only">
                Password
              </Label>
              <div className="relative">
                <Lock
                  aria-hidden="true"
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Password"
                  required
                  className="pl-10 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="remember"
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
              />
              <Label htmlFor="remember" className="text-sm cursor-pointer">
                Remember me
              </Label>
            </div>

            <HoverButton
              type="submit"
              style={signInStyle}
              className="w-full bg-gradient-to-r from-brand-green to-brand-teal text-white font-semibold text-lg py-3"
            >
              Sign In
            </HoverButton>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          © 2026 Fund Now Capital
        </p>
      </div>
    </div>
  );
}
