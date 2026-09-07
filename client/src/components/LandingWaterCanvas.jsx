import { useEffect, useRef } from "react";

const MAX_RIPPLES = 8;
const MAX_DROPLETS = 14;
const POINTER_INTERVAL_MS = 80;
const AMBIENT_INTERVAL_MS = 3200;
const MAX_PIXEL_RATIO = 1.25;

const easeOutCubic = (value) => 1 - ((1 - value) ** 3);

export default function LandingWaterCanvas({ hostRef, className = "", variant = "hero" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const host = hostRef?.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return undefined;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return undefined;

    let animationFrame = 0;
    let ambientTimer = 0;
    let lastPointerAt = 0;
    let ripples = [];
    let droplets = [];
    const surface = { width: 1, height: 1, left: 0, top: 0 };
    const intensity = (variant === "login" ? 0.9 : 1) * (reducedMotion ? 0.72 : 1);

    const scheduleFrame = () => {
      if (!animationFrame && !document.hidden) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const addRipple = (x, y, options = {}) => {
      const now = performance.now();
      ripples.push({
        x,
        y,
        bornAt: now,
        duration: options.duration || 820,
        startRadius: options.startRadius || 4,
        endRadius: options.endRadius || 62,
        opacity: (options.opacity || 0.5) * intensity,
        width: options.width || 1.5
      });
      if (ripples.length > MAX_RIPPLES) ripples = ripples.slice(-MAX_RIPPLES);
      scheduleFrame();
    };

    const addSplash = (x, y) => {
      addRipple(x, y, { duration: 920, endRadius: 88, opacity: 0.72, width: 2 });
      addRipple(x, y, { duration: 1280, startRadius: 18, endRadius: 148, opacity: 0.42 });
      const now = performance.now();
      const splashDrops = Array.from({ length: 6 }, (_, index) => {
        const angle = ((Math.PI * 2) / 6) * index + 0.25;
        const speed = 42 + ((index % 3) * 8);
        return {
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: (Math.sin(angle) * speed) - 28,
          bornAt: now,
          duration: 680 + (index * 22),
          radius: 2.3 + ((index % 2) * 0.8)
        };
      });
      droplets = [...droplets, ...splashDrops].slice(-MAX_DROPLETS);
      scheduleFrame();
    };

    function drawFrame(now) {
      animationFrame = 0;
      context.clearRect(0, 0, surface.width, surface.height);
      ripples = ripples.filter((ripple) => (now - ripple.bornAt) < ripple.duration);
      droplets = droplets.filter((droplet) => (now - droplet.bornAt) < droplet.duration);

      context.save();
      context.globalCompositeOperation = "screen";

      ripples.forEach((ripple) => {
        const progress = Math.min(1, (now - ripple.bornAt) / ripple.duration);
        const eased = easeOutCubic(progress);
        const radius = ripple.startRadius + ((ripple.endRadius - ripple.startRadius) * eased);
        const alpha = Math.max(0, ((1 - progress) ** 1.45) * ripple.opacity);

        context.beginPath();
        context.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
        context.strokeStyle = `rgba(190, 237, 247, ${alpha})`;
        context.lineWidth = ripple.width;
        context.stroke();

        const glow = context.createRadialGradient(
          ripple.x,
          ripple.y,
          Math.max(0, radius - 10),
          ripple.x,
          ripple.y,
          radius + 3
        );
        glow.addColorStop(0, "rgba(110, 205, 229, 0)");
        glow.addColorStop(0.72, `rgba(138, 218, 236, ${alpha * 0.12})`);
        glow.addColorStop(1, "rgba(218, 248, 252, 0)");
        context.beginPath();
        context.arc(ripple.x, ripple.y, radius + 3, 0, Math.PI * 2);
        context.fillStyle = glow;
        context.fill();

        context.beginPath();
        context.arc(ripple.x, ripple.y, Math.max(1, radius - 5), 0, Math.PI * 2);
        context.strokeStyle = `rgba(92, 183, 215, ${alpha * 0.42})`;
        context.lineWidth = 1;
        context.stroke();
      });

      droplets.forEach((droplet) => {
        const elapsed = (now - droplet.bornAt) / 1000;
        const progress = Math.min(1, (now - droplet.bornAt) / droplet.duration);
        const x = droplet.x + (droplet.vx * elapsed);
        const y = droplet.y + (droplet.vy * elapsed) + (92 * elapsed * elapsed);
        const alpha = Math.max(0, (1 - progress) * 0.78 * intensity);

        context.beginPath();
        context.arc(x, y, droplet.radius * (1 - (progress * 0.25)), 0, Math.PI * 2);
        context.fillStyle = `rgba(218, 248, 252, ${alpha})`;
        context.fill();
      });

      context.restore();
      if (ripples.length || droplets.length) scheduleFrame();
    }

    const resizeCanvas = () => {
      const bounds = host.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      surface.width = Math.max(1, bounds.width);
      surface.height = Math.max(1, bounds.height);
      surface.left = bounds.left;
      surface.top = bounds.top;
      canvas.width = Math.max(1, Math.round(surface.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(surface.height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      if (ripples.length || droplets.length) scheduleFrame();
    };

    const pointFromEvent = (event) => ({
      x: Math.max(0, Math.min(surface.width, event.clientX - surface.left)),
      y: Math.max(0, Math.min(surface.height, event.clientY - surface.top))
    });

    const onPointerMove = (event) => {
      const now = performance.now();
      const pointerInterval = reducedMotion ? 160 : POINTER_INTERVAL_MS;
      if ((now - lastPointerAt) < pointerInterval) return;
      lastPointerAt = now;
      const point = pointFromEvent(event);
      addRipple(point.x, point.y, {
        duration: 640,
        endRadius: 38,
        opacity: 0.58,
        width: 1.7
      });
    };

    const onPointerDown = (event) => {
      const point = pointFromEvent(event);
      addSplash(point.x, point.y);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        context.clearRect(0, 0, surface.width, surface.height);
      } else if (ripples.length || droplets.length) {
        scheduleFrame();
      }
    };

    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(resizeCanvas)
      : null;
    resizeObserver?.observe(host);
    if (!resizeObserver) window.addEventListener("resize", resizeCanvas, { passive: true });
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    host.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);

    resizeCanvas();
    const initialTimer = window.setTimeout(() => {
      addRipple(surface.width * 0.84, surface.height * 0.32, {
        duration: reducedMotion ? 850 : 1400,
        endRadius: 138,
        opacity: 0.78,
        width: 2.2
      });
    }, 450);
    if (!reducedMotion) {
      ambientTimer = window.setInterval(() => {
        if (document.hidden || ripples.length > 2) return;
        const useLeftSide = Math.random() < 0.5;
        const horizontalPosition = useLeftSide
          ? 0.1 + (Math.random() * 0.16)
          : 0.74 + (Math.random() * 0.16);
        addRipple(
          surface.width * horizontalPosition,
          surface.height * (0.22 + (Math.random() * 0.58)),
          { duration: 1250, endRadius: 94, opacity: 0.52, width: 1.8 }
        );
      }, AMBIENT_INTERVAL_MS);
    }

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(ambientTimer);
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resizeCanvas);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      context.clearRect(0, 0, surface.width, surface.height);
    };
  }, [hostRef, variant]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
