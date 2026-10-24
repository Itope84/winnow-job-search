import type { Job } from '@winnow/api';
import { memo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { companyLabel, jobAge, monogram } from '@/lib/format';
import { fonts, radius, space, type, useTheme } from '@/theme';
import { JobStatusChip } from './chips';
import { Icon, IconButton } from './ui';

const TRIGGER = 96;

export interface RowActions {
  /** Swipe right / `s`. */
  primary?: { label: string; icon: Parameters<typeof Icon>[0]['name']; run: () => void };
  /** Swipe left / `a`. */
  secondary?: { label: string; icon: Parameters<typeof Icon>[0]['name']; run: () => void };
}

/** Monogram tile for a company. */
export function CompanyTile({ company, size = 40 }: { company: string; size?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.lg,
        backgroundColor: c.surface,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: c.rule,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: fonts.mono, fontSize: size * 0.34, color: c.lead }}>
        {monogram(company)}
      </Text>
    </View>
  );
}

/**
 * One job in a list: tile, role, company · place · age, and one status chip. Swipe right for the list's
 * main move, left to archive. On a wide screen the moves show on hover instead.
 */
export const JobRow = memo(function JobRow({
  job,
  actions,
  onPress,
  selected,
  selecting,
  checked,
  onToggle,
  wide,
}: {
  job: Job;
  actions: RowActions;
  onPress: () => void;
  /** Open in the detail pane. */
  selected?: boolean;
  selecting?: boolean;
  checked?: boolean;
  onToggle?: () => void;
  wide?: boolean;
}) {
  const { c } = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const [hover, setHover] = useState(false);
  const fired = useRef(false);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
      onPanResponderMove: (_, g) => {
        const a = actionsRef.current;
        const dx = (g.dx > 0 && !a.primary) || (g.dx < 0 && !a.secondary) ? g.dx / 6 : g.dx;
        x.setValue(dx);
        setDir(dx > 4 ? 1 : dx < -4 ? -1 : 0);
      },
      onPanResponderRelease: (_, g) => {
        const a = actionsRef.current;
        const go = g.dx > TRIGGER ? a.primary : g.dx < -TRIGGER ? a.secondary : undefined;
        if (go && !fired.current) {
          fired.current = true;
          Animated.timing(x, {
            toValue: g.dx > 0 ? 600 : -600,
            duration: 160,
            useNativeDriver: Platform.OS !== 'web',
          }).start(() => {
            go.run();
            fired.current = false;
            x.setValue(0);
            setDir(0);
          });
        } else {
          Animated.spring(x, {
            toValue: 0,
            useNativeDriver: Platform.OS !== 'web',
            bounciness: 0,
          }).start(() => setDir(0));
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, {
          toValue: 0,
          useNativeDriver: Platform.OS !== 'web',
          bounciness: 0,
        }).start(() => setDir(0));
      },
    }),
  ).current;

  const meta = [companyLabel(job.company), job.location, jobAge(job)].filter(Boolean).join(' · ');

  return (
    <View
      style={{ overflow: 'hidden' }}
      // @ts-expect-error onMouseEnter/Leave exist on web.
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {dir !== 0 ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: dir > 0 ? c.sage : c.ruleStrong,
              alignItems: dir > 0 ? 'flex-start' : 'flex-end',
              justifyContent: 'center',
              paddingHorizontal: space.lg,
            },
          ]}
        >
          <Icon
            name={(dir > 0 ? actions.primary?.icon : actions.secondary?.icon) ?? 'block'}
            size={24}
            color={dir > 0 ? '#FFFFFF' : c.ink}
          />
        </View>
      ) : null}
      <Animated.View
        style={{
          transform: [{ translateX: x }],
          backgroundColor: selected ? c.surfaceRaised : c.canvas,
        }}
        {...pan.panHandlers}
      >
        <Pressable
          onPress={selecting ? onToggle : onPress}
          onLongPress={onToggle}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel={`${job.role}, ${companyLabel(job.company)}`}
          style={({ pressed }) => [
            styles.row,
            {
              borderBottomColor: c.rule,
              borderLeftColor: selected ? c.primary : 'transparent',
              backgroundColor: pressed ? c.surface : 'transparent',
            },
          ]}
        >
          {selecting ? (
            <View style={{ width: 40, alignItems: 'center' }}>
              <Icon
                name={checked ? 'check-box' : 'check-box-outline-blank'}
                tone={checked ? 'primary' : 'faint'}
              />
            </View>
          ) : (
            <CompanyTile company={job.company} />
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={[type.rowTitle, { color: c.ink }]} numberOfLines={1}>
              {job.role || 'Untitled role'}
            </Text>
            <Text style={[type.meta, { color: c.lead }]} numberOfLines={1}>
              {meta}
            </Text>
          </View>
          {wide && hover && !selecting ? (
            <View style={{ flexDirection: 'row' }}>
              {actions.primary ? (
                <IconButton
                  name={actions.primary.icon}
                  label={actions.primary.label}
                  size={36}
                  onPress={actions.primary.run}
                />
              ) : null}
              {actions.secondary ? (
                <IconButton
                  name={actions.secondary.icon}
                  label={actions.secondary.label}
                  size={36}
                  onPress={actions.secondary.run}
                />
              ) : null}
            </View>
          ) : (
            <JobStatusChip job={job} />
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
});
