export interface WakeLockHandle {
  release(): Promise<void>;
}

export async function acquireWakeLock(): Promise<WakeLockHandle> {
  let sentinel: any = null;
  let active = true;

  const requestLock = async () => {
    if (!active) return;
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && (navigator as any).wakeLock) {
      try {
        sentinel = await (navigator as any).wakeLock.request('screen');
      } catch (e) {
        // Ignore wake lock request errors (e.g. low battery mode or permission denied)
      }
    }
  };

  const handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible' && active) {
      await requestLock();
    }
  };

  await requestLock();

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }

  return {
    async release() {
      active = false;
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (sentinel && typeof sentinel.release === 'function') {
        try {
          await sentinel.release();
        } catch (e) {
          // Ignore release errors
        }
        sentinel = null;
      }
    },
  };
}
