import { useEffect, useRef } from "react";

const PARTICLE_COUNT = 36;
const COLORS = ["#4f46e5", "#818cf8"];
const FRAME_INTERVAL_MS = 1000 / 30; // cap at ~30 fps
const MIN_ALPHA = 0.15;
const MAX_ALPHA = 0.45;

interface Particle {
  baseX: number; // x the particle sways around, in CSS px
  y: number;
  radius: number;
  color: string;
  alpha: number; // steady opacity (non-twinkling particles)
  speedY: number; // px per second, downward
  swayAmp: number; // px
  swayFreq: number; // radians per second
  phase: number;
  twinkle: boolean;
  twinkleFreq: number; // radians per second
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function makeParticle(width: number, height: number): Particle {
  return {
    baseX: rand(0, width),
    y: rand(0, height),
    radius: rand(1, 3),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    alpha: rand(MIN_ALPHA, MAX_ALPHA),
    speedY: rand(6, 16),
    swayAmp: rand(4, 14),
    swayFreq: rand(0.2, 0.6),
    phase: rand(0, Math.PI * 2),
    twinkle: Math.random() < 0.2,
    twinkleFreq: rand(1.2, 2.6),
  };
}

// Decorative canvas behind the login card. It is aria-hidden and ignores the
// pointer, so it can never affect the form. Everything it starts (animation
// frame, listeners) is torn down in the effect cleanup.
export function LoginBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // jsdom (the test environment) has no canvas support: getContext returns
    // null there, so bail out quietly instead of throwing.
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let rafId: number | null = null;
    let lastFrame = 0;
    let elapsed = 0; // animation clock in seconds, advances only while running

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      // Draw in CSS pixels; the transform scales up to device pixels.
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: PARTICLE_COUNT }, () => makeParticle(width, height));
      draw();
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        const x = p.baseX + Math.sin(elapsed * p.swayFreq + p.phase) * p.swayAmp;
        const alpha = p.twinkle
          ? MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * (0.5 + 0.5 * Math.sin(elapsed * p.twinkleFreq + p.phase))
          : p.alpha;
        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = p.color;
        ctx!.beginPath();
        ctx!.arc(x, p.y, p.radius, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalAlpha = 1;
    }

    function tick(now: number) {
      rafId = requestAnimationFrame(tick);
      const sinceLast = now - lastFrame;
      if (sinceLast < FRAME_INTERVAL_MS) return;
      // Clamp dt so a long pause (hidden tab) does not make particles jump.
      const dt = Math.min(sinceLast, 100) / 1000;
      lastFrame = now;
      elapsed += dt;
      for (const p of particles) {
        p.y += p.speedY * dt;
        if (p.y > height + p.radius) {
          p.y = -p.radius;
          p.baseX = rand(0, width);
        }
      }
      draw();
    }

    function start() {
      if (rafId !== null || document.hidden) return;
      lastFrame = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function handleVisibility() {
      if (document.hidden) stop();
      else start();
    }

    resize(); // also paints the first frame
    window.addEventListener("resize", resize);
    if (!reducedMotion) {
      document.addEventListener("visibilitychange", handleVisibility);
      start();
    }

    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
