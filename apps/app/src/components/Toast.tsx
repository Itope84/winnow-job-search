import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChrome } from '@/lib/chrome';
import { useToast } from '@/lib/toast';
import { fonts, radius, space, TAB_HEIGHT, type, useTheme } from '@/theme';

/** One line at the bottom with an optional Undo. */
export function Toast() {
  const { c, scheme } = useTheme();
  const { text, action, hide } = useToast();
  const insets = useSafeAreaInsets();
  const { tabs } = useChrome();
  if (!text) return null;
  const bg = scheme === 'dark' ? '#ECEAE4' : '#1E1E1C';
  const fg = scheme === 'dark' ? '#161614' : '#FBFBFA';
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: (tabs ? TAB_HEIGHT : 0) + insets.bottom + space.md,
        alignItems: 'center',
        paddingHorizontal: space.md,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={{
          maxWidth: 560,
          width: '100%',
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          backgroundColor: bg,
          borderRadius: radius.lg,
          paddingLeft: space.md,
          paddingRight: action ? space.xs : space.md,
          minHeight: 48,
        }}
      >
        <Text
          style={[type.bodySmall, { color: fg, flex: 1, paddingVertical: 12 }]}
          numberOfLines={2}
        >
          {text}
        </Text>
        {action ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              action.run();
              hide();
            }}
            style={{ paddingHorizontal: space.md, paddingVertical: 12 }}
          >
            <Text
              style={{
                fontFamily: fonts.uiSemibold,
                fontSize: 14,
                color: c.primary === '#1F6F78' ? '#86CBD2' : '#1F6F78',
              }}
            >
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
