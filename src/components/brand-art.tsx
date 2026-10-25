"use client";

import { useId } from "react";

const artwork = {
  symbol: {
    source: "/brand/lifepilot-symbol.png",
    viewBox: "215 113 879 1029",
  },
  wordmark: { source: "/brand/lifepilot-logo.png", viewBox: "239 924 781 169" },
} as const;

// Crop only the viewport. The uploaded PNGs stay unchanged, including the wordmark.
// An SVG luminance mask lets currentColor replace white without a black rectangle.
export function BrandArt({
  variant = "symbol",
  className = "",
}: {
  variant?: keyof typeof artwork;
  className?: string;
}) {
  const maskId = useId();
  const { source, viewBox } = artwork[variant];
  return (
    <svg
      className={`brand-art ${className}`}
      viewBox={viewBox}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="1254"
          height="1254"
          style={{ maskType: "luminance" }}
        >
          <image href={source} x="0" y="0" width="1254" height="1254" />
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="1254"
        height="1254"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
