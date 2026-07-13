import { useEffect, useRef } from "react";

const TRAIL_INTERVAL_MS = 12;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export default function WaterRippleOverlay({
  hostRef,
  className = "",
  intensity = "hero"
}) {
  const overlayRef = useRef(null);
  const pointerStateRef = useRef(null);

  useEffect(() => {
    const host = hostRef?.current;
    const overlay = overlayRef.current;
    if (!host || !overlay) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let lastTrailAt = 0;
    const intensityClass = intensity === "login"
      ? "water-ripple-overlay--login"
      : "water-ripple-overlay--hero";
    overlay.classList.add(intensityClass);

    const createRippleNode = (x, y, variant, size) => {
      const node = document.createElement("span");
      node.className = `water-ripple-overlay__ripple water-ripple-overlay__ripple--${variant}`;
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      return node;
    };

    const createDropletNode = (x, y, offsetX, offsetY, delayMs = 0) => {
      const node = document.createElement("span");
      node.className = "water-ripple-overlay__droplet";
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.setProperty("--drop-x", `${offsetX}px`);
      node.style.setProperty("--drop-y", `${offsetY}px`);
      node.style.animationDelay = `${delayMs}ms`;
      return node;
    };

    const createSweepNode = (x, y, angleDeg, width, thickness, opacity) => {
      const node = document.createElement("span");
      node.className = "water-ripple-overlay__sweep";
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.width = `${width}px`;
      node.style.height = `${thickness}px`;
      node.style.setProperty("--sweep-rotation", `${angleDeg}deg`);
      node.style.setProperty("--sweep-opacity", String(opacity));
      return node;
    };

    const mountAnimatedNode = (node) => {
      overlay.appendChild(node);
      node.addEventListener("animationend", () => node.remove(), { once: true });
    };

    const pointFromEvent = (event) => {
      const bounds = host.getBoundingClientRect();
      return {
        x: clamp(event.clientX - bounds.left, 0, bounds.width),
        y: clamp(event.clientY - bounds.top, 0, bounds.height),
        width: bounds.width,
        height: bounds.height
      };
    };

    const spawnTrail = (x, y, size = 22) => {
      mountAnimatedNode(createRippleNode(x, y, "trail", size));
    };

    const spawnSweep = (x, y, angleDeg, width, thickness, opacity) => {
      mountAnimatedNode(createSweepNode(x, y, angleDeg, width, thickness, opacity));
    };

    const spawnSplash = (x, y) => {
      mountAnimatedNode(createRippleNode(x, y, "splash", 72));
      mountAnimatedNode(createRippleNode(x, y, "shock", 164));
      [
        [-34, -24, 0],
        [30, -28, 18],
        [-22, 28, 42],
        [34, 20, 64],
        [0, -40, 82],
        [-10, -36, 96]
      ].forEach(([offsetX, offsetY, delay]) => {
        mountAnimatedNode(createDropletNode(x, y, offsetX, offsetY, delay));
      });
    };

    const onPointerMove = (event) => {
      const now = performance.now();
      if ((now - lastTrailAt) < TRAIL_INTERVAL_MS) return;
      lastTrailAt = now;
      const point = pointFromEvent(event);
      const previous = pointerStateRef.current;
      if (previous) {
        const elapsed = Math.max(now - previous.time, 1);
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const distance = Math.sqrt((dx * dx) + (dy * dy));
        const speed = distance / elapsed;
        const vx = dx / elapsed;
        const vy = dy / elapsed;
        const trailSize = clamp(20 + (speed * 34), 20, 36);
        const sweepAngle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const sweepWidth = Math.max(point.width, point.height) * 1.55;
        const sweepThickness = clamp(74 + (speed * 70), 74, 132);
        const sweepOpacity = clamp(0.12 + (speed * 0.18), 0.12, 0.28);
        spawnTrail(point.x, point.y, trailSize);
        spawnSweep(point.x, point.y, sweepAngle, sweepWidth, sweepThickness, sweepOpacity);

        const previousSpeed = Math.sqrt((previous.vx * previous.vx) + (previous.vy * previous.vy));
        if (previousSpeed > 0.12 && speed > 0.12) {
          const dot = ((previous.vx * vx) + (previous.vy * vy)) / (previousSpeed * speed);
          if (dot < -0.15) {
            mountAnimatedNode(createRippleNode(point.x, point.y, "shock", 110));
            spawnSweep(point.x, point.y, sweepAngle, sweepWidth * 1.08, sweepThickness * 1.16, Math.min(0.34, sweepOpacity + 0.08));
          }
        }

        pointerStateRef.current = { x: point.x, y: point.y, vx, vy, time: now };
      } else {
        spawnTrail(point.x, point.y, 22);
        pointerStateRef.current = { x: point.x, y: point.y, vx: 0, vy: 0, time: now };
      }

      overlay.style.setProperty("--pointer-x", `${point.x}px`);
      overlay.style.setProperty("--pointer-y", `${point.y}px`);
      overlay.style.setProperty("--pointer-opacity", "1");
    };

    const onPointerDown = (event) => {
      const point = pointFromEvent(event);
      spawnSplash(point.x, point.y);
      pointerStateRef.current = { x: point.x, y: point.y, vx: 0, vy: 0, time: performance.now() };
      overlay.style.setProperty("--pointer-x", `${point.x}px`);
      overlay.style.setProperty("--pointer-y", `${point.y}px`);
      overlay.style.setProperty("--pointer-opacity", "1");
    };

    const onPointerLeave = () => {
      pointerStateRef.current = null;
      overlay.style.setProperty("--pointer-opacity", "0");
    };

    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointerleave", onPointerLeave);

    return () => {
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerleave", onPointerLeave);
      overlay.classList.remove(intensityClass);
    };
  }, [hostRef, intensity]);

  return (
    <div ref={overlayRef} className={className} aria-hidden="true">
      <div className="water-ripple-overlay__highlight"></div>
    </div>
  );
}
