import { useEffect, useRef } from "react";

interface Props {
  intensity?: number; // 0..1 — pulse amount
  className?: string;
}

/**
 * Living oscilloscope background — a soft, breathing waveform.
 * Reacts to `intensity` prop (e.g. on key press / message).
 */
export function Oscilloscope({ intensity = 0.4, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRef = useRef(intensity);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    let pulse = 0;
    let dpr = window.devicePixelRatio || 1;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // target intensity easing
      const target = intensityRef.current;
      pulse += (target - pulse) * 0.06;

      const midY = h / 2;
      const amp = h * 0.12 * (0.4 + pulse);

      // primary amber waveform
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "oklch(0.72 0.14 55 / 0.35)";
      ctx.shadowColor = "oklch(0.72 0.14 55 / 0.5)";
      ctx.shadowBlur = 12;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const phase = x * 0.012 + t * 0.025;
        const y =
          midY +
          Math.sin(phase) * amp +
          Math.sin(phase * 2.3 + 1.2) * amp * 0.4 +
          Math.sin(phase * 0.5 + 0.7) * amp * 0.5;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // secondary signal-green waveform (subtle)
      ctx.lineWidth = 0.8;
      ctx.strokeStyle = "oklch(0.78 0.16 145 / 0.18)";
      ctx.shadowColor = "oklch(0.78 0.16 145 / 0.3)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const phase = x * 0.018 - t * 0.018;
        const y =
          midY +
          Math.sin(phase + 0.5) * amp * 0.7 +
          Math.cos(phase * 1.7) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.shadowBlur = 0;
      t += 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none ${className}`}
      aria-hidden
    />
  );
}
