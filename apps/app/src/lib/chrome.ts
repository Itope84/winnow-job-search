import { usePathname } from 'expo-router';
import { useWide } from '@/theme';

/** The four top-level places. */
export const TABS = ['/', '/find', '/activity', '/you'] as const;

const SIGNED_OUT = ['/signin', '/welcome'];
/** Full-screen flows with no navigation. */
const BARE = ['/setup'];

/** Which navigation the current screen shows: a bottom tab bar on phones, a left rail on wide screens. */
export function useChrome() {
  const path = usePathname();
  const wide = useWide();
  const signedOut = SIGNED_OUT.includes(path);
  const bare = signedOut || BARE.includes(path);
  const top = (TABS as readonly string[]).includes(path);
  return { tabs: !wide && top && !bare, rail: wide && !bare, signedOut };
}
