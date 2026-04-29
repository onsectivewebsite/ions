/**
 * Client app placeholder — Phase 9.2 will mirror the web portal:
 * sign-in, case status, documents, messages, payments.
 */
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ClientPlaceholder() {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.container}>
        <Text style={styles.brand}>OnsecBoad</Text>
        <Text style={styles.h1}>Coming soon</Text>
        <Text style={styles.body}>
          Your firm&apos;s client app is on the way. For now, sign in to your secure portal in the
          browser to track your file, upload documents, and message your firm.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAFAF7' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  brand: { fontSize: 14, color: '#B5132B', fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  h1: { fontSize: 36, fontWeight: '700', color: '#111827', marginTop: 12, marginBottom: 16 },
  body: { textAlign: 'center', color: '#4b5563', fontSize: 15, lineHeight: 22, maxWidth: 360 },
});
