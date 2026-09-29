import { useEffect, useState } from 'react';

// Logo is hosted on the backend (backend/public/), not the frontend — each
// store already has its own backend deployment (VITE_API_BASE_URL differs
// per Vercel project), so this naturally resolves to that store's own logo
// with no extra per-store frontend env var needed.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

function candidatesFor(variant) {
  // SVG preferred (vector, scales cleanly, transparent by default) — falls
  // back to a raster file if only that was uploaded for this variant.
  return [`${API_BASE_URL}/logo_${variant}.svg`, `${API_BASE_URL}/logo_${variant}.jpeg`];
}

function tryLoad(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// variant: 'white' (for dark backgrounds, e.g. the TopBar) or 'black' (for
// light backgrounds, e.g. the login page / favicon). Resolves to null — each
// consumer's own default — if that variant hasn't been uploaded.
export default function useLogoSrc(variant) {
  const [logoSrc, setLogoSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLogoSrc(null);
    (async () => {
      for (const candidate of candidatesFor(variant)) {
        const resolved = await tryLoad(candidate);
        if (cancelled) return;
        if (resolved) {
          setLogoSrc(resolved);
          return;
        }
      }
      if (!cancelled) setLogoSrc(null);
    })();
    return () => { cancelled = true; };
  }, [variant]);

  return logoSrc;
}
