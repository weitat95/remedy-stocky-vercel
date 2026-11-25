import { useEffect, useState } from 'react';

// true while the browser believes it has a network connection. It only reacts to the browser's own
// online/offline events, so a server that is down while the Wi-Fi is up is still reported by request errors.
export default function useOnlineStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
