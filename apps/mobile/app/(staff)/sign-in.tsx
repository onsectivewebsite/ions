/**
 * Email + password → ticket → /2fa.
 *
 * Mirrors the apps/web sign-in flow. Calls auth.signInPassword which
 * returns a `ticket` to use against verify2FA.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { rpcMutation, RpcError } from '../../src/shared/api';

type SignInResp = { ticket: string; methods: ('totp' | 'email_otp')[] };

export default function SignInScreen() {
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
      const r = await rpcMutation<SignInResp>('auth.signIn', {
        email: email.trim().toLowerCase(),
        password,
      });
      // If the user has TOTP enrolled, prefer it; otherwise email OTP.
      const method: 'totp' | 'email' = r.methods.includes('totp') ? 'totp' : 'email';
      router.replace({
        pathname: '/(staff)/2fa',
        params: { ticket: r.ticket, method, email: email.trim().toLowerCase() },
      });
    } catch (err) {
      const msg = err instanceof RpcError ? err.message : 'Sign in failed';
      Alert.alert('Sign in', msg);
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
          <Text style={styles.h1}>OnsecBoad</Text>
          <Text style={styles.subtitle}>Sign in with your firm credentials.</Text>

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
              placeholder="you@firm.example"
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
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
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
  h1: { fontSize: 32, fontWeight: '700', color: '#111827' },
  subtitle: { marginTop: 4, marginBottom: 32, color: '#6b7280' },
  field: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { height: 48, borderRadius: 8, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff', paddingHorizontal: 12, fontSize: 16, color: '#111827' },
  button: { marginTop: 24, height: 48, borderRadius: 8, backgroundColor: '#B5132B', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
