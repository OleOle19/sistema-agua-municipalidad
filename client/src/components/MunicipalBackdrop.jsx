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
  const { resolvedImageUrl } = useLandingBackground(landingHeroArt);
  const [displayImageUrl, setDisplayImageUrl] = useState(() => resolvedImageUrl || "");

  useEffect(() => {
    const nextImageUrl = String(resolvedImageUrl || "").trim();
    if (!nextImageUrl || nextImageUrl === displayImageUrl) return;

    let cancelled = false;
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (!cancelled) {
        setDisplayImageUrl(nextImageUrl);
      }
    };
    image.onerror = () => {
      if (!cancelled && !displayImageUrl) {
        setDisplayImageUrl(nextImageUrl);
      }
    };
    image.src = nextImageUrl;

    return () => {
      cancelled = true;
    };
  }, [displayImageUrl, resolvedImageUrl]);

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
        {displayImageUrl ? (
          <>
            <img
              src={displayImageUrl}
              alt=""
              className="municipal-backdrop__image"
              draggable="false"
            />
            <LandingWaterCanvas
              src={displayImageUrl}
              hostRef={hostRef}
              className="municipal-backdrop__canvas"
            />
          </>
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
