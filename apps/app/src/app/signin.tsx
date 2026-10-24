import { router } from 'expo-router';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { Input } from '@/components/inputs';
import { Button, Field, Notice, T } from '@/components/ui';
import { api } from '@/lib/api';
import { keys, queryClient } from '@/lib/query';
import { space, type, useTheme } from '@/theme';

export default function SignIn() {
  const { c } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = await api.login(email.trim(), password);
      queryClient.setQueryData(keys.me, me);
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{
        flex: 1,
        backgroundColor: c.canvas,
        justifyContent: 'center',
        alignItems: 'center',
        padding: space.md,
      }}
    >
      <View style={{ width: '100%', maxWidth: 380, gap: space.md }}>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: space.md }}
        >
          <Image
            source={require('../../assets/images/icon.png')}
            style={{ width: 44, height: 44, borderRadius: 11 }}
          />
          <Text style={[type.display, { color: c.ink }]}>winnow</Text>
        </View>
        <T variant="body" tone="lead">
          Find jobs, sort them, and score the good ones against your CV.
        </T>
        {error ? <Notice tone="danger" title={error} /> : null}
        <Field label="Username or email">
          <Input
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="username"
            textContentType="username"
            autoFocus
          />
        </Field>
        <Field label="Password">
          <Input
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => void submit()}
          />
        </Field>
        <Button
          label="Sign in"
          busy={busy}
          disabled={!email.trim() || !password}
          onPress={() => void submit()}
        />
        <T variant="meta" tone="faint">
          Winnow is invite-only. Forgot your password? Ask whoever runs your Winnow for a new invite
          link.
        </T>
      </View>
    </KeyboardAvoidingView>
  );
}
