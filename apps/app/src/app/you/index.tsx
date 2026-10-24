import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Segmented } from '@/components/inputs';
import { Button, Icon, Notice, Row, Screen, SectionTitle, T } from '@/components/ui';
import { api } from '@/lib/api';
import { useHealth, useJack, useMe, useProfile, useSettings } from '@/lib/hooks';
import { usePrefs } from '@/lib/prefs';
import { keys, queryClient } from '@/lib/query';
import { space, type, useTheme } from '@/theme';

export default function You() {
  const { c } = useTheme();
  const me = useMe().data;
  const profile = useProfile().data;
  const settings = useSettings().data;
  const health = useHealth().data;
  const jack = useJack().data;
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const signOut = async () => {
    await api.logout().catch(() => {});
    queryClient.clear();
    queryClient.setQueryData(keys.me, undefined);
    router.replace('/signin');
  };
  const setSetupLater = usePrefs((s) => s.setSetupLater);
  const openSetup = async () => {
    setSetupLater(null);
    if (me?.setup === 'done') {
      const state = await api.startSetup(true).catch(() => null);
      if (state) queryClient.setQueryData(keys.setup, state);
    }
    router.push('/setup' as never);
  };
  const cvWords = profile?.cv ? profile.cv.split(/\s+/).length : 0;
  return (
    <Screen>
      <View style={{ paddingTop: space.md, gap: 4 }}>
        <Text style={[type.display, { color: c.ink }]}>{me?.name ?? 'You'}</Text>
        <Text style={[type.bodySmall, { color: c.lead }]}>
          {me ? `Username ${me.id} · ${me.email}` : ''}
        </Text>
      </View>
      {profile && (!profile.ready.cv || !profile.ready.profile) ? (
        <Notice
          tone="warning"
          icon="warning-amber"
          title="Triage and scoring need your CV and targets"
          body="Add them below so the AI judges jobs against you."
        />
      ) : null}
      <SectionTitle>What steers triage and scoring</SectionTitle>
      <Row
        title="CV"
        subtitle={cvWords ? `${cvWords.toLocaleString()} words` : 'Not added yet'}
        leading={<Icon name="description" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/cv' as never)}
      />
      <Row
        title="Profile and targets"
        subtitle="Who you are, your North Star, roles, places, pay, deal-breakers"
        leading={<Icon name="flag" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/profile' as never)}
      />
      <Row
        title="Scoring"
        subtitle={
          settings
            ? `Apply now ${settings.bands.applyNow}+ · Apply ${settings.bands.apply}+ · Maybe ${settings.bands.maybe}+`
            : ''
        }
        leading={<Icon name="insights" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/scoring' as never)}
      />
      <Row
        title={me?.setup === 'done' ? 'Set up again' : 'Finish setting up'}
        subtitle={
          me?.setup === 'done'
            ? 'Go through setup with AI again, starting from today’s profile'
            : 'CV, targets, a drafted profile and sources, in about 10 minutes'
        }
        leading={<Icon name="assignment-ind" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => void openSetup()}
      />
      <SectionTitle>Connections</SectionTitle>
      <Row
        title="Jack & Jill"
        subtitle={
          jack?.connected
            ? jack.problem
              ? 'Needs reconnecting'
              : 'Connected'
            : 'Connect your Jack account to search the jobs Jack finds'
        }
        leading={<Icon name="link" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/jack' as never)}
      />
      <SectionTitle>Settings</SectionTitle>
      <Row
        title="AI"
        subtitle={
          settings
            ? `${settings.cli === 'claude' ? 'Claude Code' : 'OpenCode'} · ${settings.models.score ?? settings.models.default ?? 'default model'}`
            : ''
        }
        leading={<Icon name="memory" tone="lead" />}
        trailing={<Icon name="chevron-right" tone="faint" />}
        onPress={() => router.push('/you/settings' as never)}
      />
      {me?.admin ? (
        <Row
          title="People"
          subtitle="Invite family, reset a sign-in"
          leading={<Icon name="group" tone="lead" />}
          trailing={<Icon name="chevron-right" tone="faint" />}
          onPress={() => router.push('/you/people' as never)}
        />
      ) : null}
      <View style={{ paddingVertical: space.md, gap: space.sm }}>
        <T variant="caps" tone="lead">
          Theme
        </T>
        <Segmented
          value={theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(v) => setTheme(v as typeof theme)}
        />
      </View>
      <Button kind="secondary" label="Sign out" icon="logout" onPress={() => void signOut()} />
      <T variant="meta" tone="faint" style={{ marginTop: space.lg, textAlign: 'center' }}>
        Winnow {health?.version ?? ''} ·{' '}
        {health
          ? `${health.cli.id} ${health.cli.installed ? (health.cli.version ?? '') : 'not installed'}`
          : ''}
      </T>
    </Screen>
  );
}
