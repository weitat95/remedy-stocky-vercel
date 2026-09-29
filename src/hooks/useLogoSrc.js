import { useEffect, useState } from 'react';

// Logo is hosted on the backend (backend/public/logo.jpeg), not the frontend —
// each store already has its own backend deployment (VITE_API_BASE_URL differs
// per Vercel project), so this naturally resolves to that store's own logo
// with no extra per-store frontend env var needed.
const LOGO_PATH = `${import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'}/logo.jpeg`;

// Resolves to the logo URL only if it actually loads — lets every consumer
// fall back to its own default when no logo has been configured/uploaded yet.
export default function useLogoSrc() {
  const [logoSrc, setLogoSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setLogoSrc(LOGO_PATH); };
    img.onerror = () => { if (!cancelled) setLogoSrc(null); };
    img.src = LOGO_PATH;
    return () => { cancelled = true; };
  }, []);

  return logoSrc;
}
