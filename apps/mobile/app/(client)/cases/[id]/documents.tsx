/**
 * Client document upload — mirror of the web /portal/cases/[id]/documents.
 *
 * Uses expo-document-picker to pick a file from the device, then POSTs
 * raw bytes to /api/v1/portal/cases/:caseId/upload (Phase 7.5 endpoint,
 * scope=client). The server enforces collection state, item match, and
 * size/accept-type validation.
 *
 * Submit-and-lock is intentionally available here — same UX as web.
 * Only Law Firm Admin / Branch Manager can unlock from the staff side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import Constants from 'expo-constants';
import { Badge, Button, C, Card, CardTitle } from '../../../../src/shared/ui';
import { rpcMutation, rpcQuery, RpcError } from '../../../../src/shared/api';
import { getClientToken, setClientToken } from '../../../../src/shared/session';

type ChecklistItem = {
  key: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string[];
  maxSizeMb?: number;
};

type Upload = {
  id: string;
  itemKey: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
};

type CollectionResp = {
  case: { id: string; caseType: string; status: string };
  collection:
    | {
        id: string;
        status: 'DRAFT' | 'SENT' | 'LOCKED' | 'UNLOCKED';
        submittedAt: string | null;
        lockedAt: string | null;
      }
    | null;
  items: ChecklistItem[];
  uploads: Upload[];
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function apiBaseUrl(): string {
  return (Constants.expoConfig?.extra?.apiBaseUrl as string) ?? 'http://localhost:4000';
}

export default function ClientDocumentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<CollectionResp | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const r = await rpcQuery<CollectionResp>(
        'portal.documentCollectionForCase',
        { caseId: id },
        { token },
      );
      setData(r);
    } catch (err) {
      if (err instanceof RpcError && (err.code === 'UNAUTHORIZED' || err.code === 'FORBIDDEN')) {
        await setClientToken(null);
        router.replace('/(client)/sign-in');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pickAndUpload(item: ChecklistItem): Promise<void> {
    setBusy(item.key);
    try {
      const accept = item.accept && item.accept.length > 0 ? item.accept : ['*/*'];
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        // Pass MIME types only; expo-document-picker maps file extensions
        // to types under the hood when possible.
        type: accept,
      });
      if (picked.canceled || !picked.assets?.[0]) {
        setBusy(null);
        return;
      }
      const asset = picked.assets[0];
      // Read as bytes — fetch the file:// URI and pull the ArrayBuffer.
      const fileRes = await fetch(asset.uri);
      const blob = await fileRes.blob();
      const buffer = await blob.arrayBuffer();

      const token = await getClientToken();
      if (!token) {
        router.replace('/(client)/sign-in');
        return;
      }
      const url = `${apiBaseUrl()}/api/v1/portal/cases/${encodeURIComponent(id ?? '')}/upload?itemKey=${encodeURIComponent(item.key)}&fileName=${encodeURIComponent(asset.name)}&contentType=${encodeURIComponent(asset.mimeType ?? 'application/octet-stream')}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': asset.mimeType ?? 'application/octet-stream',
        },
        body: buffer,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Upload failed (${res.status})`);
      }
      await load();
    } catch (err) {
      Alert.alert('Upload', err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  }

  async function downloadOne(uploadId: string): Promise<void> {
    try {
      const token = await getClientToken();
      const r = await rpcMutation<{ url: string }>(
        'portal.documentDownloadUrl',
        { uploadId },
        { token },
      );
      void Linking.openURL(r.url);
    } catch (err) {
      Alert.alert('Download', err instanceof Error ? err.message : 'Could not generate link');
    }
  }

  async function submit(): Promise<void> {
    Alert.alert(
      'Submit documents?',
      "This locks the collection. You won't be able to upload more without your firm unlocking.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              const token = await getClientToken();
              const r = await rpcMutation<{ ok: boolean; missingRequired?: Array<{ key: string; label: string }> }>(
                'portal.submitDocuments',
                { caseId: id },
                { token },
              );
              if (r.missingRequired && r.missingRequired.length > 0) {
                Alert.alert(
                  'Submitted with missing items',
                  `${r.missingRequired.length} required item(s) still missing — your firm may unlock for re-upload: ${r.missingRequired.map((m) => m.label).join(', ')}`,
                );
              }
              await load();
            } catch (err) {
              Alert.alert('Submit', err instanceof Error ? err.message : 'Submit failed');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ],
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: true, title: 'Documents' }} />
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const uploadsByKey = new Map<string, Upload[]>();
  for (const u of data.uploads) {
    const list = uploadsByKey.get(u.itemKey) ?? [];
    list.push(u);
    uploadsByKey.set(u.itemKey, list);
  }
  const required = data.items.filter((it) => it.required);
  const requiredDone = required.filter((it) => (uploadsByKey.get(it.key)?.length ?? 0) > 0).length;
  const locked = data.collection?.status === 'LOCKED';
  const noCollection = data.collection === null;

  return (
    <SafeAreaView style={styles.root}>
      <Stack.Screen options={{ headerShown: true, title: 'Documents' }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        {noCollection ? (
          <Card>
            <CardTitle>Nothing requested yet</CardTitle>
            <Text style={styles.muted}>
              Your firm hasn&apos;t requested any documents on this file yet. Items will appear here when they do.
            </Text>
          </Card>
        ) : locked ? (
          <Card>
            <CardTitle>Documents submitted</CardTitle>
            <Text style={styles.muted}>
              Thank you. We received your documents
              {data.collection?.submittedAt
                ? ` on ${new Date(data.collection.submittedAt).toLocaleString()}`
                : ''}
              . If you need to upload anything else, message your firm — they can unlock the collection.
            </Text>
          </Card>
        ) : (
          <>
            <Card>
              <View style={styles.headerLine}>
                <CardTitle>Upload checklist</CardTitle>
                <Badge tone={requiredDone === required.length ? 'success' : 'warning'}>
                  {requiredDone}/{required.length} required
                </Badge>
              </View>
              <Text style={styles.muted}>
                You can return to this screen anytime. Submit when everything is uploaded — that locks the collection.
              </Text>
            </Card>

            {data.items.map((item) => {
              const uploads = uploadsByKey.get(item.key) ?? [];
              const complete = uploads.length > 0;
              return (
                <Card key={item.key}>
                  <View style={styles.itemHeader}>
                    <View style={styles.itemHeaderLeft}>
                      <View
                        style={[styles.dot, { backgroundColor: complete ? C.success : C.border }]}
                      />
                      <Text style={styles.itemLabel}>{item.label}</Text>
                      {item.required ? <Badge tone="warning">Required</Badge> : null}
                    </View>
                  </View>
                  {item.description ? (
                    <Text style={styles.itemDesc}>{item.description}</Text>
                  ) : null}
                  <Text style={styles.itemAcceptLine}>
                    {item.accept?.length ? `Accepts: ${item.accept.join(', ')}` : 'Any type'}
                    {item.maxSizeMb ? ` · max ${item.maxSizeMb} MB` : ''}
                  </Text>
                  <Button
                    onPress={() => void pickAndUpload(item)}
                    busy={busy === item.key}
                    variant="secondary"
                    style={{ marginTop: 10 }}
                  >
                    {complete ? 'Replace' : 'Upload'}
                  </Button>

                  {uploads.length > 0 ? (
                    <View style={styles.uploadList}>
                      {uploads.map((u) => (
                        <Pressable
                          key={u.id}
                          onPress={() => void downloadOne(u.id)}
                          style={({ pressed }) => [styles.uploadRow, pressed && { opacity: 0.7 }]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.uploadName}>{u.fileName}</Text>
                            <Text style={styles.uploadMeta}>
                              {fmtBytes(u.sizeBytes)} · {new Date(u.createdAt).toLocaleString()}
                            </Text>
                          </View>
                          <Text style={styles.downloadLink}>Download</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </Card>
              );
            })}

            <Card>
              <CardTitle>Submit when ready</CardTitle>
              <Text style={styles.muted}>
                Submitting locks this collection. Your firm will see everything you uploaded and proceed with file preparation.
              </Text>
              <Button
                busy={submitting}
                onPress={() => void submit()}
                style={{ marginTop: 12 }}
              >
                Submit and lock
              </Button>
            </Card>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { padding: 16, gap: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.textMuted, fontSize: 13, lineHeight: 18, marginTop: 4 },
  headerLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  itemLabel: { flex: 1, color: C.text, fontSize: 15, fontWeight: '600' },
  itemDesc: { marginTop: 6, color: C.textMuted, fontSize: 12 },
  itemAcceptLine: { marginTop: 6, color: C.textMuted, fontSize: 11 },
  uploadList: { marginTop: 12, gap: 6, borderTopColor: C.borderMuted, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  uploadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  uploadName: { color: C.text, fontSize: 13 },
  uploadMeta: { color: C.textMuted, fontSize: 11, marginTop: 2 },
  downloadLink: { color: C.primary, fontWeight: '600', fontSize: 13 },
});
