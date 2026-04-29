/**
 * Lobby TV placeholder — Phase 9.3 will show today's appointments,
 * walk-in queue, branding, and live updates.
 */
import { StyleSheet, Text, View } from 'react-native';

export default function TvPlaceholder() {
  return (
    <View style={styles.root}>
      <Text style={styles.brand}>OnsecBoad · Lobby</Text>
      <Text style={styles.h1}>Display preparing…</Text>
      <Text style={styles.body}>
        Today&apos;s schedule and walk-in queue will appear here once the firm enrols this device.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center', padding: 64 },
  brand: { fontSize: 18, color: '#94a3b8', fontWeight: '600', letterSpacing: 2, textTransform: 'uppercase' },
  h1: { fontSize: 56, fontWeight: '800', color: '#fff', marginTop: 16, marginBottom: 16 },
  body: { textAlign: 'center', color: '#cbd5e1', fontSize: 18, lineHeight: 26, maxWidth: 720 },
});
