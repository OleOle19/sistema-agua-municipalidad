import { useEffect, useRef, useState } from "react";
import landingHeroArt from "../assets/landing-hero-art-v1.jpg";
import useLandingBackground from "../hooks/useLandingBackground";
import LandingWaterCanvas from "./LandingWaterCanvas";

export default function MunicipalBackdrop({
  children,
  className = "",
  contentClassName = "",
  variant = "hero"
}) {
  const hostRef = useRef(null);
  const { resolvedMediaUrl, mediaType } = useLandingBackground(landingHeroArt);
  const [displayMedia, setDisplayMedia] = useState(() => ({
    url: resolvedMediaUrl || "",
    type: mediaType || "image"
  }));

  useEffect(() => {
    const nextMediaUrl = String(resolvedMediaUrl || "").trim();
    const nextMediaType = mediaType === "video" ? "video" : "image";
    if (!nextMediaUrl || (nextMediaUrl === displayMedia.url && nextMediaType === displayMedia.type)) return;

    if (nextMediaType === "video") {
      const frameId = window.requestAnimationFrame(() => {
        setDisplayMedia({ url: nextMediaUrl, type: "video" });
      });
      return () => window.cancelAnimationFrame(frameId);
    }

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!cancelled) {
        setDisplayMedia({ url: nextMediaUrl, type: "image" });
      }
    };
    image.onerror = () => {
      if (!cancelled && !displayMedia.url) {
        setDisplayMedia({ url: nextMediaUrl, type: "image" });
      }
    };
    image.src = nextMediaUrl;

    return () => {
      cancelled = true;
    };
  }, [displayMedia.type, displayMedia.url, mediaType, resolvedMediaUrl]);

  const rootClassName = [
    "municipal-backdrop",
    `municipal-backdrop--${variant}`,
    className
  ].filter(Boolean).join(" ");

  const innerClassName = [
    "municipal-backdrop__content",
    contentClassName
  ].filter(Boolean).join(" ");

  return (
    <section
      ref={hostRef}
      className={rootClassName}
    >
      <div className="municipal-backdrop__media" aria-hidden="true">
        {displayMedia.url ? (
          displayMedia.type === "video" ? (
            <video
              key={displayMedia.url}
              src={displayMedia.url}
              className="municipal-backdrop__video"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
          ) : (
            <>
              <img
                src={displayMedia.url}
                alt=""
                className="municipal-backdrop__image"
                draggable="false"
              />
              <LandingWaterCanvas
                src={displayMedia.url}
                hostRef={hostRef}
                className="municipal-backdrop__canvas"
              />
            </>
          )
        ) : (
          <div className="municipal-backdrop__placeholder"></div>
        )}
        <div className="municipal-backdrop__veil"></div>
      </div>

      <div className={innerClassName}>
        {children}
      </div>
    </section>
  );
}
