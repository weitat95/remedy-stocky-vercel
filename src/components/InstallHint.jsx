import React, { useState } from 'react';
import { Banner, Text } from '@shopify/polaris';

const KEY = 'installHintDismissed';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };

// iOS has no install prompt: people have to use Share, then Add to Home Screen. Show that once, in
// Safari only (not once it's already installed), and let them dismiss it for good.
function shouldShow() {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !installed && !read();
}

export default function InstallHint() {
  const [show, setShow] = useState(shouldShow);
  if (!show) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setShow(false); };
  return (
    <Banner title="Install this on your iPad" onDismiss={dismiss}>
      <Text as="p">Tap the Share button in Safari, then “Add to Home Screen”. It then opens full screen like an app.</Text>
    </Banner>
  );
}
