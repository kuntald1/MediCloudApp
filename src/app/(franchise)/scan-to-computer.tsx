import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { authHeader, API_BASE } from '../../../src/utils/auth';
import { scanBridge } from '../../scanBridge';

/**
 * Scan to Computer — the phone is the barcode reader for the billing screen.
 *
 * Whatever is scanned here is sent to the server, and the web page picks it up
 * within a second and drops it into the Accession No. box that is waiting for
 * it. The pairing is the login: a scan only ever reaches the SAME user, so two
 * people scanning at once never cross over.
 *
 * On the computer: New Bill (or a bill's detail) → press 📱 beside the sample
 * → scan here.
 *
 * The camera lives in its own full-screen route (src/app/scan-camera.tsx) and
 * hands the code back through scanBridge — the same arrangement Change Report
 * Status uses, so both screens behave identically.
 */

interface SentItem { id: string; code: string; ok: boolean; detail: string; at: string }

export default function ScanToComputer() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<SentItem[]>([]);
  const inputRef = useRef<TextInput>(null);
  const lockRef = useRef(false);   // stops one camera frame burst firing twice

  const send = async (raw?: string) => {
    const value = (raw ?? code).trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/scan-relay/push`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value, source: 'mobile' }),
      });
      const data = await res.json().catch(() => ({}));
      const ok = res.ok && !!data.ok;
      setSent(prev => [{
        id: `${Date.now()}_${Math.random()}`,
        code: value,
        ok,
        detail: ok ? 'Sent — check the computer' : (data.detail || 'Could not send'),
        at: new Date().toLocaleTimeString(),
      }, ...prev].slice(0, 40));
      if (ok) setCode('');
    } catch (e: any) {
      setSent(prev => [{ id: `${Date.now()}`, code: value, ok: false,
                         detail: e?.message || 'No connection', at: new Date().toLocaleTimeString() }, ...prev]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  // The camera route closes itself after a scan; the code arrives here once
  // this screen is focused again.
  useFocusEffect(
    useCallback(() => scanBridge.subscribe((scanned) => {
      lockRef.current = false;
      send(scanned);
    }), []) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const openCamera = () => {
    if (lockRef.current) return;
    lockRef.current = true;
    scanBridge.clear();           // drop anything left from an abandoned scan
    router.push('/scan-camera' as any);
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.hint}>
          Scan a tube label here and the number appears in the{' '}
          <Text style={styles.strong}>Accession No.</Text> box on your computer.
        </Text>
        <Text style={styles.sub}>
          On the computer open <Text style={styles.strong}>New Bill</Text> or a bill, press the{' '}
          <Text style={styles.strong}>📱</Text> button beside the sample, then scan. Both devices must be
          logged in as the same user.
        </Text>

        <TouchableOpacity style={styles.cameraBtn} onPress={openCamera} disabled={busy}>
          <Text style={styles.cameraIcon}>📷</Text>
          <Text style={styles.cameraText}>Scan with Camera</Text>
        </TouchableOpacity>

        <Text style={styles.divider}>— or use a scanner / type manually —</Text>

        <TextInput ref={inputRef} style={styles.input} value={code} onChangeText={setCode}
          placeholder="Scan barcode / accession label..." placeholderTextColor="#94A3B8"
          onSubmitEditing={() => send()} returnKeyType="send" autoFocus
          editable={!busy} blurOnSubmit={false} autoCapitalize="characters" autoCorrect={false} />
        {busy && <ActivityIndicator color="#17B9A1" style={{ marginTop: 8 }} />}
      </View>

      <FlatList
        data={sent}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: item.ok ? '#17B9A1' : '#EF4444' }]}>
            <Text style={styles.rowIcon}>{item.ok ? '✅' : '❌'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowCode}>{item.code}</Text>
              <Text style={[styles.rowDetail, { color: item.ok ? '#0F766E' : '#EF4444' }]}>
                {item.detail} · {item.at}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📱</Text>
            <Text style={styles.emptyText}>Scan a label to send it to your computer</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#F8FAFC' },
  card:       { backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  hint:       { fontSize: 14, color: '#334155', lineHeight: 20 },
  sub:        { fontSize: 12.5, color: '#64748B', lineHeight: 18, marginTop: 6 },
  strong:     { fontWeight: '700', color: '#0F766E' },
  cameraBtn:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                backgroundColor: '#17B9A1', borderRadius: 12, paddingVertical: 16, marginTop: 14 },
  cameraIcon: { fontSize: 20 },
  cameraText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  divider:    { textAlign: 'center', color: '#94A3B8', fontSize: 12, marginTop: 12, marginBottom: 8 },
  input:      { borderWidth: 1.5, borderColor: '#17B9A1', borderRadius: 12, paddingHorizontal: 14,
                paddingVertical: 12, fontSize: 15, color: '#0F172A', backgroundColor: '#FFFFFF' },
  row:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF',
                borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  rowIcon:    { fontSize: 16 },
  rowCode:    { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  rowDetail:  { fontSize: 12, marginTop: 2 },
  empty:      { alignItems: 'center', paddingTop: 48 },
  emptyIcon:  { fontSize: 34, marginBottom: 10 },
  emptyText:  { color: '#94A3B8', fontSize: 14 },
});
