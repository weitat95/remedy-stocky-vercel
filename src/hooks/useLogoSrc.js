import { useEffect, useState } from 'react';

// Logo is hosted on the backend (backend/public/), not the frontend — each
// store already has its own backend deployment (VITE_API_BASE_URL differs
// per Vercel project), so this naturally resolves to that store's own logo
// with no extra per-store frontend env var needed.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// SVG preferred (vector, scales cleanly, transparent by default) — falls back
// to the raster file if only that was uploaded, then to null (each consumer's
// own default) if neither exists.
const LOGO_CANDIDATES = [`${API_BASE_URL}/logo.svg`, `${API_BASE_URL}/logo.jpeg`];

function tryLoad(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export default function useLogoSrc() {
  const [logoSrc, setLogoSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const candidate of LOGO_CANDIDATES) {
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
  }, []);

  return logoSrc;
}
