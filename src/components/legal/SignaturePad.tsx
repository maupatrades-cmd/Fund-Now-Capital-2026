import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/*
 * Build 8.3 — dependency-free signature pad.
 *
 * No signature library: the whole job is "capture pointer strokes, draw them,
 * hand back a PNG", and every candidate package brings a bundle and a
 * maintenance surface for that. (Same reasoning that kept react-markdown out of
 * the T&C renderer.)
 *
 * Strokes are kept as point arrays rather than as pixels so a resize (rotating a
 * phone mid-signature) can REDRAW them instead of clearing the canvas — losing a
 * half-drawn signature to an orientation change would be a nasty surprise on the
 * one screen where the user is trying to be careful.
 *
 * The exported PNG has a transparent background so it can later be composited
 * onto the executed PDF without a white box around it.
 */

export type SignaturePadHandle = {
  /** PNG blob of the drawn strokes, or null when nothing has been drawn. */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
};

type Point = { x: number; y: number };

const PAD_HEIGHT = 176;
const STROKE_WIDTH = 2.2;
const STROKE_COLOR = "#1a3a52"; // brand navy

export const SignaturePad = forwardRef<
  SignaturePadHandle,
  { disabled?: boolean; onInkChange?: (hasInk: boolean) => void }
>(function SignaturePad({ disabled = false, onInkChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const currentRef = useRef<Point[] | null>(null);
  const [hasInk, setHasInk] = useState(false);

  // Redraw every stored stroke at the current size/DPR.
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    // Only resize the backing store when it actually changed — assigning
    // width/height clears the canvas.
    const wantW = Math.round(rect.width * dpr);
    const wantH = Math.round(PAD_HEIGHT * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, PAD_HEIGHT);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = STROKE_COLOR;

    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      if (stroke.length === 1) {
        // A single tap still leaves a mark (a dot), rather than nothing.
        ctx.arc(stroke[0].x, stroke[0].y, STROKE_WIDTH / 2, 0, Math.PI * 2);
        ctx.fillStyle = STROKE_COLOR;
        ctx.fill();
        continue;
      }
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i += 1) {
        ctx.lineTo(stroke[i].x, stroke[i].y);
      }
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    redraw();
    const onResize = () => redraw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [redraw]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    currentRef.current = [pointFrom(e)];
    strokesRef.current = [...strokesRef.current, currentRef.current];
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !currentRef.current) return;
    currentRef.current.push(pointFrom(e));
    redraw();
  };

  const endStroke = () => {
    if (!currentRef.current) return;
    currentRef.current = null;
    if (!hasInk) {
      setHasInk(true);
      onInkChange?.(true);
    }
  };

  const clear = useCallback(() => {
    strokesRef.current = [];
    currentRef.current = null;
    setHasInk(false);
    onInkChange?.(false);
    redraw();
  }, [onInkChange, redraw]);

  useImperativeHandle(
    ref,
    () => ({
      clear,
      toBlob: () =>
        new Promise<Blob | null>((resolve) => {
          const canvas = canvasRef.current;
          if (!canvas || strokesRef.current.length === 0) {
            resolve(null);
            return;
          }
          canvas.toBlob((blob) => resolve(blob), "image/png");
        }),
    }),
    [clear],
  );

  return (
    <div>
      <div
        className={`relative rounded-lg border-2 border-dashed ${
          disabled ? "border-slate-200 bg-slate-50" : "border-slate-300 bg-white"
        }`}
      >
        <canvas
          ref={canvasRef}
          style={{ height: PAD_HEIGHT, width: "100%", touchAction: "none" }}
          className={disabled ? "cursor-not-allowed" : "cursor-crosshair"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={endStroke}
          onPointerCancel={endStroke}
          aria-label="Signature drawing area"
          role="img"
        />
        {!hasInk && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            {disabled ? "Complete the acknowledgements first" : "Draw your signature here"}
          </p>
        )}
        {/* Signature baseline, drawn in DOM so it never lands in the exported PNG. */}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-slate-200" />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Use a finger, stylus or mouse. Prefer typing? Switch to the Type tab.
        </p>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasInk}
          className="text-xs font-semibold text-slate-500 underline underline-offset-2 disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
});
