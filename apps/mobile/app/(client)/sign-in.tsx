/**
 * Client portal sign-in — email + password only (per Phase 5.5).
 *
 * portal.signIn returns { accessToken, expiresAt } directly; no 2FA
 * step. Setup flow (?token=…) is browser-only in 9.3 — clients
 * complete the invite link from email + browser, then sign in here.
 */
import { useState } from 'react';
import { router } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { rpcMutation, RpcError } from '../../src/shared/api';
import { setClientToken } from '../../src/shared/session';

type SignInResp = { accessToken: string; expiresAt: string };

export default function ClientSignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Email and password are both required.');
      return;
    }
    setBusy(true);
    try {
      const r = await rpcMutation<SignInResp>('portal.signIn', {
        email: email.trim().toLowerCase(),
        password,
      });
      await setClientToken(r.accessToken);
      router.replace('/(client)/(tabs)');
    } catch (err) {
      Alert.alert('Sign in', err instanceof RpcError ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  function openSetupHelp(): void {
    const portalUrl = (Constants.expoConfig?.extra?.portalUrl as string) ?? '';
    if (portalUrl) void Linking.openURL(portalUrl);
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Text style={styles.brand}>OnsecBoad</Text>
          <Text style={styles.h1}>Welcome</Text>
          <Text style={styles.subtitle}>Sign in to your client portal.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              secureTextEntry
              textContentType="password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.button, busy && { opacity: 0.6 }, pressed && { opacity: 0.7 }]}
            onPress={() => void submit()}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
          </Pressable>

          <Pressable style={styles.linkBtn} onPress={openSetupHelp} hitSlop={8}>
            <Text style={styles.linkText}>
              First time here? Open the setup link your firm sent you (browser).
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAF7' },
  flex: { flex: 1 },
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  brand: { fontSize: 12, color: '#B5132B', fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  h1: { fontSize: 32, fontWeight: '700', color: '#111827', marginTop: 12 },
  subtitle: { marginTop: 4, marginBottom: 32, color: '#6b7280' },
  field: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { height: 48, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 16, color: '#111827' },
  button: { marginTop: 24, height: 48, borderRadius: 8, backgroundColor: '#B5132B', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  linkBtn: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#6b7280', fontSize: 12, textAlign: 'center' },
});
