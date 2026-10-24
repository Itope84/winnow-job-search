import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
} from '@expo-google-fonts/newsreader';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Rail, TabBar } from '@/components/Nav';
import { Toast } from '@/components/Toast';
import { Loading } from '@/components/ui';
import { ApiError, setSignedOutHandler } from '@/lib/api';
import { useChrome } from '@/lib/chrome';
import { useMe } from '@/lib/hooks';
import { events, watchForeground } from '@/lib/live';
import { usePrefs } from '@/lib/prefs';
import { keys, queryClient } from '@/lib/query';
import { ThemeProvider, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

// The built web app installs its service worker (installable, opens offline). Not in `expo start`.
if (
  Platform.OS === 'web' &&
  !__DEV__ &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator
) {
  const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

setSignedOutHandler(() => {
  queryClient.setQueryData(keys.me, undefined);
  void queryClient.invalidateQueries({ queryKey: keys.me });
});

function Shell() {
  const { c, scheme } = useTheme();
  const pathname = usePathname();
  const me = useMe();
  const { tabs, rail, signedOut } = useChrome();
  const signedIn = !!me.data;
  const unauth = me.error instanceof ApiError && me.error.status === 401;

  const setupLater = usePrefs((s) => s.setupLater);
  const needsSetup = !!me.data && me.data.setup !== 'done' && setupLater !== me.data.id;

  // Signed out: everything goes to Sign in (invite links go to Welcome). A new account goes to setup
  // until it is done or put off on this device.
  useEffect(() => {
    if (unauth && !signedOut) router.replace('/signin');
    else if (signedIn && needsSetup && pathname !== '/setup') router.replace('/setup');
    else if (signedIn && signedOut) router.replace('/');
  }, [unauth, signedIn, signedOut, needsSetup, pathname]);

  useEffect(() => {
    if (!signedIn) {
      events.stop();
      return;
    }
    events.start();
    const unwatch = watchForeground();
    return () => {
      unwatch();
      events.stop();
    };
  }, [signedIn]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = c.canvas;
      document.documentElement.style.colorScheme = scheme;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.canvas);
    }
  }, [c.canvas, scheme]);

  if (me.isLoading && !signedOut)
    return (
      <View style={{ flex: 1, backgroundColor: c.canvas, justifyContent: 'center' }}>
        <Loading label="Opening Winnow" />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, flexDirection: 'row' }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {rail && signedIn ? <Rail /> : null}
      <View style={{ flex: 1 }}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.canvas },
            animation: 'fade',
          }}
        />
        {tabs && signedIn ? <TabBar /> : null}
        <Toast />
      </View>
    </View>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
    Newsreader_500Medium,
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
  });
  const hydrated = usePrefs((s) => s.hydrated);
  useEffect(() => {
    if (loaded && hydrated) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, hydrated]);
  if (!loaded || !hydrated) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
