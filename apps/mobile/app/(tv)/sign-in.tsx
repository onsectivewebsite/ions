/**
 * TV pairing sign-in. Same auth.signIn → 2FA flow as the staff app, but
 * landscape + dark + larger type. The user signing in here is the
 * receptionist or admin pairing this physical TV; once 2FA is verified,
 * we land on /pair to choose which branch this display represents.
 */
import { useState } from 'react';
import { router } from 'expo-router';
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

type SignInResp = { ticket: string; methods: ('totp' | 'email_otp')[] };

export default function TvSignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!email || !password) {
      Alert.alert('Pair this display', 'Email and password are both required.');
      return;
    }
    setBusy(true);
    try {
      const r = await rpcMutation<SignInResp>('auth.signIn', {
        email: email.trim().toLowerCase(),
        password,
      });
      const method: 'totp' | 'email' = r.methods.includes('totp') ? 'totp' : 'email';
      router.replace({
        pathname: '/(tv)/2fa',
        params: { ticket: r.ticket, method, email: email.trim().toLowerCase() },
      });
    } catch (err) {
      Alert.alert('Sign in', err instanceof RpcError ? err.message : 'Sign in failed');
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
          <Text style={styles.h1}>Pair this display</Text>
          <Text style={styles.subtitle}>
            Sign in once with any firm account to enrol this TV. We&apos;ll then ask which branch
            it&apos;s for.
          </Text>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@firm.example"
                placeholderTextColor="#475569"
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                placeholderTextColor="#475569"
              />
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.button,
                (busy || !email || !password) && { opacity: 0.5 },
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => void submit()}
              disabled={busy || !email || !password}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Continue</Text>
              )}
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
  h1: { fontSize: 48, fontWeight: '800', color: '#fff', marginTop: 16 },
  subtitle: { color: '#cbd5e1', fontSize: 18, marginTop: 12, marginBottom: 36, textAlign: 'center', maxWidth: 640 },
  form: { width: '100%', maxWidth: 480, gap: 14 },
  field: { gap: 6 },
  label: { color: '#94a3b8', fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: {
    height: 52,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    fontSize: 18,
    color: '#fff',
  },
  button: {
    marginTop: 12,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#B5132B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 18 },
});
