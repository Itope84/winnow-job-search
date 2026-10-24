import { router, usePathname } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveRuns } from '@/lib/hooks';
import { fonts, MAX_WIDTH, RAIL_WIDTH, space, TAB_HEIGHT, useTheme } from '@/theme';
import { Icon, type IconName } from './ui';

const ITEMS: { path: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  {
    path: '/',
    label: 'Jobs',
    icon: 'work-outline',
    match: (p) => p === '/' || p.startsWith('/job/'),
  },
  { path: '/find', label: 'Find', icon: 'travel-explore', match: (p) => p.startsWith('/find') },
  {
    path: '/activity',
    label: 'Activity',
    icon: 'timeline',
    match: (p) => p.startsWith('/activity') || p.startsWith('/run/'),
  },
  { path: '/you', label: 'You', icon: 'person-outline', match: (p) => p.startsWith('/you') },
];

function useBadges() {
  const runs = useActiveRuns();
  const list = runs.data ?? [];
  return {
    '/activity': list.some((r) => r.status === 'needs_input')
      ? 'amber'
      : list.length
        ? 'primary'
        : null,
  } as Record<string, 'amber' | 'primary' | null>;
}

/** Bottom navigation on phones. */
export function TabBar() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const badges = useBadges();
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: c.canvas, borderTopColor: c.rule, paddingBottom: insets.bottom },
      ]}
    >
      <View style={styles.row} accessibilityRole="tablist">
        {ITEMS.map((item) => {
          const on = item.match(path);
          const dot = badges[item.path];
          return (
            <Pressable
              key={item.path}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item.label}
              onPress={() => {
                if (path !== item.path) router.replace(item.path as never);
              }}
              style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View>
                <Icon name={item.icon} size={24} tone={on ? 'primary' : 'lead'} />
                {dot ? (
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: dot === 'amber' ? c.amber : c.primary,
                        borderColor: c.canvas,
                      },
                    ]}
                  />
                ) : null}
              </View>
              <Text
                style={{
                  fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                  fontSize: 11,
                  color: on ? c.primaryInk : c.lead,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Left rail on wide screens. */
export function Rail() {
  const { c } = useTheme();
  const path = usePathname();
  const badges = useBadges();
  return (
    <View style={[styles.rail, { backgroundColor: c.canvas, borderRightColor: c.rule }]}>
      <Pressable
        accessibilityLabel="Winnow"
        onPress={() => router.replace('/')}
        style={{ marginBottom: space.lg }}
      >
        <Image
          source={require('../../assets/images/icon.png')}
          style={{ width: 36, height: 36, borderRadius: 9 }}
        />
      </Pressable>
      {ITEMS.map((item) => {
        const on = item.match(path);
        const dot = badges[item.path];
        return (
          <Pressable
            key={item.path}
            accessibilityRole="link"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.label}
            onPress={() => {
              if (path !== item.path) router.replace(item.path as never);
            }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.railItem,
              {
                backgroundColor: on
                  ? c.primarySoft
                  : hovered || pressed
                    ? c.surface
                    : 'transparent',
              },
            ]}
          >
            <View>
              <Icon name={item.icon} size={22} tone={on ? 'primary' : 'lead'} />
              {dot ? (
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: dot === 'amber' ? c.amber : c.primary,
                      borderColor: c.canvas,
                    },
                  ]}
                />
              ) : null}
            </View>
            <Text
              style={{
                fontFamily: on ? fonts.uiSemibold : fonts.uiMedium,
                fontSize: 11,
                color: on ? c.primaryInk : c.lead,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  row: { flexDirection: 'row', width: '100%', maxWidth: MAX_WIDTH, height: TAB_HEIGHT },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  dot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  rail: {
    width: RAIL_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    paddingTop: space.md,
    gap: space.xs,
  },
  railItem: { width: 68, paddingVertical: 10, borderRadius: 8, alignItems: 'center', gap: 4 },
});
