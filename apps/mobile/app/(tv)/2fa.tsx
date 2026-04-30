/**
 * TV 2FA — same flow as staff: requestEmailOtp on mount when method=email,
 * then verify2FA. On success, store the firm token under the TV namespace
 * and go to /pair to pick the branch.
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
import { rpcMutation, RpcError } from '../../src/shared/api';
import { setTvToken } from '../../src/shared/session';

type VerifyResp = { accessToken: string; expiresAt: string };

export default function TvTwoFAScreen() {
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
      await setTvToken(r.accessToken);
      router.replace('/(tv)/pair');
    } catch (err) {
      Alert.alert('Verify', err instanceof RpcError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <View style={styles.center}>
          <Text style={styles.brand}>OnsecBoad · Lobby</Text>
          <Text style={styles.h1}>Verify it&apos;s you</Text>
          <Text style={styles.subtitle}>
            {method === 'email'
              ? `We sent a 6-digit code to ${params.email}.`
              : 'Enter the code from your authenticator app.'}
          </Text>
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              maxLength={8}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor="#475569"
            />
            <Pressable
              style={({ pressed }) => [
                styles.button,
                (busy || code.length < 4) && { opacity: 0.5 },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => void verify()}
              disabled={busy || code.length < 4}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
            </Pressable>
            <Pressable onPress={() => router.replace('/(tv)/sign-in')} hitSlop={12}>
              <Text style={styles.linkText}>Back to sign-in</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 48 },
  brand: { fontSize: 14, color: '#94a3b8', fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  h1: { fontSize: 44, fontWeight: '800', color: '#fff', marginTop: 16 },
  subtitle: { color: '#cbd5e1', fontSize: 18, marginTop: 12, marginBottom: 32, textAlign: 'center' },
  form: { width: 360, gap: 14 },
  input: {
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    fontSize: 28,
    color: '#fff',
    textAlign: 'center',
    letterSpacing: 8,
  },
  button: {
    height: 52,
    borderRadius: 8,
    backgroundColor: '#B5132B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 18 },
  linkText: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 8 },
});
