/**
 * Messages tab — chat thread with the firm.
 *
 * Mirrors /portal/messages: cross-case thread with bubbled CLIENT vs
 * STAFF messages. Auto mark-read on focus + on initial load. Composer
 * pinned to the bottom of the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C } from '../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../src/shared/api';
import { getClientToken, setClientToken } from '../../../src/shared/session';

type Sender = 'CLIENT' | 'STAFF' | 'SYSTEM';

type Message = {
  id: string;
  sender: Sender;
  body: string;
  createdAt: string;
  readByClient: string | null;
  readByStaff: string | null;
};

export default function ClientMessagesScreen() {
  const [items, setItems] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const r = await rpcQuery<Message[]>('portal.messagesList', undefined, { token });
      setItems(r);
      // Mark unread STAFF messages read.
      await rpcMutation('portal.messagesMarkRead', undefined, { token });
    } catch (err) {
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setClientToken(null);
        router.replace('/(client)/sign-in');
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    // Auto-scroll to the latest message after each render.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [items]);

  async function send(): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const token = await getClientToken();
      await rpcMutation('portal.messagesSend', { body: trimmed }, { token });
      setBody('');
      await load();
    } catch {
      /* surfaced silently — load() will reflect any state */
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.h1}>Messages</Text>
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent}>
          {items.length === 0 ? (
            <Text style={styles.emptyHint}>
              No messages yet. Send the first one below — your firm will get notified.
            </Text>
          ) : (
            items.map((m) => <Bubble key={m.id} m={m} />)
          )}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={body}
            onChangeText={setBody}
            placeholder="Type a message…"
            placeholderTextColor={C.textMuted}
            multiline
            maxLength={5000}
          />
          <Pressable
            onPress={() => void send()}
            disabled={busy || body.trim().length === 0}
            style={({ pressed }) => [
              styles.sendBtn,
              (busy || body.trim().length === 0) && { opacity: 0.5 },
              pressed && { opacity: 0.7 },
            ]}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ m }: { m: Message }) {
  const isClient = m.sender === 'CLIENT';
  const isSystem = m.sender === 'SYSTEM';
  return (
    <View style={[styles.bubbleRow, isClient ? styles.alignRight : styles.alignLeft]}>
      <View
        style={[
          styles.bubble,
          isSystem
            ? styles.bubbleSystem
            : isClient
              ? styles.bubbleClient
              : styles.bubbleStaff,
        ]}
      >
        <Text style={[styles.bubbleText, isClient && styles.bubbleTextClient, isSystem && styles.bubbleTextSystem]}>
          {m.body}
        </Text>
        <Text style={[styles.bubbleMeta, isClient && styles.bubbleMetaClient]}>
          {new Date(m.createdAt).toLocaleString()}
          {isClient ? (m.readByStaff ? ' · seen' : ' · sent') : !m.readByClient ? ' · new' : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { padding: 16, paddingBottom: 8 },
  h1: { fontSize: 28, fontWeight: '700', color: C.text },
  thread: { flex: 1 },
  threadContent: { padding: 16, gap: 8 },
  emptyHint: { textAlign: 'center', color: C.textMuted, fontSize: 13, padding: 32 },
  bubbleRow: { flexDirection: 'row' },
  alignRight: { justifyContent: 'flex-end' },
  alignLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleClient: { backgroundColor: C.primary },
  bubbleStaff: { backgroundColor: C.surface, borderColor: C.borderMuted, borderWidth: 1 },
  bubbleSystem: { borderColor: C.border, borderWidth: 1, borderStyle: 'dashed', backgroundColor: 'transparent' },
  bubbleText: { color: C.text, fontSize: 14, lineHeight: 20 },
  bubbleTextClient: { color: C.textOnPrimary },
  bubbleTextSystem: { color: C.textMuted, fontStyle: 'italic' },
  bubbleMeta: { marginTop: 4, fontSize: 10, color: C.textMuted },
  bubbleMetaClient: { color: 'rgba(255,255,255,0.85)' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopColor: C.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: C.surface,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.bg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: C.text,
  },
  sendBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: C.textOnPrimary, fontWeight: '600', fontSize: 14 },
});
