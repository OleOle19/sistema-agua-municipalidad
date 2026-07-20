import { useEffect, useRef } from "react";

const supportsReducedMotion = () => (
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
);

export default function LandingWaterCanvas({ src = "", className = "" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !src) return undefined;

    let app = null;
    let disposed = false;
    let idleHandle = null;
    let timeoutHandle = null;

    const startLiquidBackground = async () => {
      try {
        const { default: LiquidBackground } = await import("../vendor/liquid1.min.js");
        if (disposed) return;

        app = LiquidBackground(canvas);
        app.loadImage(src);
        app.setRain(false);

        if (app.liquidPlane) {
          app.liquidPlane.material.metalness = 0;
          app.liquidPlane.material.roughness = 1;
          app.liquidPlane.material.emissive.set(0x000000);
          app.liquidPlane.material.color.set(0xffffff);
          app.liquidPlane.uniforms.displacementScale.value = supportsReducedMotion() ? 0.9 : 1.5;
        }

        canvas.dataset.liquidReady = "true";
      } catch (error) {
        console.warn("No se pudo iniciar el fondo liquido:", error);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(startLiquidBackground, { timeout: 1500 });
    } else {
      timeoutHandle = window.setTimeout(startLiquidBackground, 250);
    }

    return () => {
      disposed = true;
      if (idleHandle !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
      app?.dispose?.();
    };
  }, [src]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
