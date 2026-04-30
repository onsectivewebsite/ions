/**
 * 2FA — request email OTP (or use TOTP) and verify.
 *
 * Same dual-mode setup as the web side. Email OTP fires automatically
 * on mount when method=email; the user just enters the 6-digit code.
 * TOTP path uses the user's authenticator app.
 */
import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { rpcMutation, RpcError } from '../../src/shared/api';
import { setStaffToken } from '../../src/shared/session';
import { registerPush } from '../../src/shared/push';

type VerifyResp = { accessToken: string; expiresAt: string };

export default function TwoFAScreen() {
  const params = useLocalSearchParams<{ ticket: string; method: 'totp' | 'email'; email: string }>();
  const ticket = String(params.ticket ?? '');
  const method = (params.method as 'totp' | 'email') ?? 'email';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    if (method === 'email' && ticket && !otpSent) {
      setOtpSent(true);
      void rpcMutation('auth.requestEmailOtp', { ticket }).catch((err) => {
        Alert.alert('Email OTP', err instanceof RpcError ? err.message : 'Failed to send OTP');
      });
    }
  }, [method, ticket, otpSent]);

  async function verify(): Promise<void> {
    if (!code) return;
    setBusy(true);
    try {
      const r = await rpcMutation<VerifyResp>('auth.verify2FA', {
        ticket,
        code: code.trim(),
      });
      await setStaffToken(r.accessToken);
      // Phase 9.5 — opportunistically register the device. Best-effort;
      // never blocks the sign-in flow.
      void registerPush('staff', r.accessToken);
      router.replace('/(staff)/(tabs)');
    } catch (err) {
      Alert.alert('Verify', err instanceof RpcError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.container}>
          <Text style={styles.h1}>Verify it's you</Text>
          <Text style={styles.subtitle}>
            {method === 'email'
              ? `We sent a 6-digit code to ${params.email}.`
              : 'Enter the 6-digit code from your authenticator app.'}
          </Text>

          <View style={styles.field}>
            <Text style={styles.label}>Code</Text>
            <TextInput
              style={styles.input}
              autoCapitalize="characters"
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor="#94a3b8"
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.button, busy && { opacity: 0.6 }, pressed && { opacity: 0.7 }]}
            onPress={() => void verify()}
            disabled={busy || code.length < 4}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
          </Pressable>

          <Pressable
            style={styles.linkButton}
            onPress={() => router.replace('/(staff)/sign-in')}
            disabled={busy}
          >
            <Text style={styles.linkText}>Back to sign-in</Text>
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
  h1: { fontSize: 28, fontWeight: '700', color: '#111827' },
  subtitle: { marginTop: 4, marginBottom: 32, color: '#6b7280' },
  field: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { height: 56, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 22, color: '#111827', textAlign: 'center', letterSpacing: 6 },
  button: { marginTop: 24, height: 48, borderRadius: 8, backgroundColor: '#B5132B', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  linkButton: { marginTop: 16, alignItems: 'center' },
  linkText: { color: '#6b7280', fontSize: 14 },
});
