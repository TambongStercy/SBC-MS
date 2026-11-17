import { useEffect, useState } from 'react';

/** Chrome's non-standard install event. Not in lib.dom, so declared here. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'sbc-admin-install-dismissed-at';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari predates display-mode and uses this instead.
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; the touch check separates it.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const wasRecentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISSED_KEY) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
};

/*
 * Chrome fires beforeinstallprompt once, early on page load. Captured here at
 * module level (this module loads with the app shell) so any screen — the
 * banner, the profile, the notification settings — can offer to install,
 * even one opened long after the event fired.
 */
let captured: BeforeInstallPromptEvent | null = null;
let installedThisSession = false;
const subscribers = new Set<() => void>();
const publish = () => subscribers.forEach(fn => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chrome's own mini-infobar so ours is the only prompt.
    e.preventDefault();
    captured = e as BeforeInstallPromptEvent;
    publish();
  });
  window.addEventListener('appinstalled', () => {
    installedThisSession = true;
    captured = null;
    publish();
  });
}

/**
 * Install affordance for both platforms.
 *
 * Android/Chrome fires beforeinstallprompt, which must be captured and
 * replayed from a user gesture. iOS Safari has no such API at all — the only
 * route is Share -> "Sur l'écran d'accueil" — so there we show instructions
 * instead of a button that cannot work.
 */
export function useInstallPrompt() {
  const [, rerender] = useState(0);
  const [dismissed, setDismissed] = useState(wasRecentlyDismissed);

  useEffect(() => {
    const onChange = () => rerender(n => n + 1);
    subscribers.add(onChange);
    return () => { subscribers.delete(onChange); };
  }, []);

  const installed = installedThisSession || isStandalone();

  const install = async () => {
    const event = captured;
    if (!event) return 'unavailable' as const;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use: Chrome will fire a fresh one if still eligible.
    captured = null;
    if (outcome === 'accepted') installedThisSession = true;
    publish();
    return outcome;
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* private mode — the banner simply reappears next session */
    }
    setDismissed(true);
  };

  const ios = isIos();
  // The banner: not installed, not snoozed, and something to offer.
  const canShow = !installed && !dismissed && (!!captured || ios);

  return { canShow, isIos: ios, canPromptNatively: !!captured, install, dismiss, installed };
}
