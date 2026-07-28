import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { scanBridge } from '../../scanBridge';

const STATUS_FLOW = [
  { key: 'collected',  label: '🧪 Collected',  color: '#3B82F6' },
  { key: 'received',   label: '📥 Received',   color: '#06B6D4' },
  { key: 'tested',     label: '🔬 Tested',     color: '#F97316' },
  { key: 'validated',  label: '✅ Validated',  color: '#A855F7' },
  { key: 'reported',   label: '📄 Reported',   color: '#10B981' },
];

const STATUS_COLOR: Record<string, string> = { pending: '#F59E0B', collected: '#3B82F6', received: '#06B6D4', tested: '#F97316', validated: '#A855F7', reported: '#10B981', sample_rejected: '#EF4444', outsource: '#8B5CF6' };
const STATUS_LABEL: Record<string, string> = { outsource: 'OUTSOURCED', sample_rejected: 'REJECTED' };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

type Mode = 'search' | 'scan';
interface ScanLogItem { id: string; code: string; outcome: 'advanced' | 'skipped' | 'not_found'; detail: string; }

export default function ChangeStatus() {
  const [mode, setMode] = useState<Mode>('search');

  // ── Search mode state
  const [barcode, setBarcode]     = useState('');
  const [accession, setAccession] = useState('');
  const [results, setResults]     = useState<any[]>([]);
  const [selected, setSelected]   = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  // ── Scan mode state
  const [scanCode, setScanCode]     = useState('');
  const [scanBusy, setScanBusy]     = useState(false);
  const [scanLog, setScanLog]       = useState<ScanLogItem[]>([]);
  const scanInputRef = useRef<TextInput>(null);

  // ── Camera scanner — lives in its own full-screen route (src/app/scan-camera.tsx)
  // rather than an in-screen Modal/overlay, so it truly covers the whole device
  // screen (including the drawer header) and avoids the Android CameraView-in-Modal
  // black-screen issue. Scanned codes come back via scanBridge.
  const cameraLockRef = useRef(false); // prevents double-firing on the same frame burst

  // Receive the scanned code whenever this screen is focused (i.e. right after
  // the camera route calls router.back()).
  useFocusEffect(
    React.useCallback(() => {
      const unsubscribe = scanBridge.subscribe((code) => {
        cameraLockRef.current = false;
        handleScan(code);
      });
      return unsubscribe;
    }, []) // eslint-disable-line
  );

  const searchSamples = async () => {
    if (!barcode.trim() && !accession.trim()) return;
    setSearching(true); setResults([]); setSelected([]);
    try {
      const params = new URLSearchParams();
      if (barcode.trim())    params.set('barcode', barcode.trim());
      if (accession.trim())  params.set('accession_number', accession.trim());
      const res  = await fetch(`${API_BASE}/api/sample-status/search?${params.toString()}`, { headers: authHeader() });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSearching(false); }
  };

  const toggleSelect = (id: number) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const advance = async (status: string) => {
    if (selected.length === 0) { Alert.alert('Select at least one sample'); return; }
    setAdvancing(true);
    try {
      const res  = await fetch(`${API_BASE}/api/sample-status/advance`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: selected, status }),
      });
      const data = await res.json();
      if (!res.ok || !data.updated) {
        Alert.alert('Nothing updated', `${data.detail ?? 'No matching samples were changed. Please check and try again.'}`);
        return;
      }
      Alert.alert('✅ Done', `${data.updated} sample(s) → ${status}`);
      setResults(prev => prev.map(r => selected.includes(r.id) ? { ...r, status } : r));
      setSelected([]);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setAdvancing(false); }
  };

  const reject = () => Alert.alert('Reject Samples', `Reject ${selected.length} sample(s)?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Reject', style: 'destructive', onPress: () => advance('sample_rejected') },
  ]);

  // ── Scan Mode: every scan moves that sample straight to Received —
  // but ONLY if it's currently Collected. Anything further along
  // (tested, validated, reported, ...) is left untouched.
  const handleScan = async (rawCode?: string) => {
    const code = (rawCode ?? scanCode).trim();
    if (!code) return;
    setScanBusy(true);
    try {
      // The confirmed API contract is barcode=X **or** accession_number=X, never both
      // together (sending both was silently returning zero matches for every scan,
      // since per-test accession codes never equal the patient-level barcode).
      // Try accession_number first — that's what's printed on per-test sample
      // labels, which is what Scan Mode is built around — then fall back to a
      // patient-barcode lookup for scanner-gun / manual-entry cases.
      let match: any = null;
      const accRes = await fetch(`${API_BASE}/api/sample-status/search?accession_number=${encodeURIComponent(code)}`, { headers: authHeader() });
      const accData = await accRes.json().catch(() => []);
      match = Array.isArray(accData) ? accData[0] : null;

      if (!match) {
        const bcRes = await fetch(`${API_BASE}/api/sample-status/search?barcode=${encodeURIComponent(code)}`, { headers: authHeader() });
        const bcData = await bcRes.json().catch(() => []);
        match = Array.isArray(bcData) ? bcData[0] : null;
      }

      if (!match) {
        setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'not_found', detail: 'Not found' }, ...prev].slice(0, 30));
      } else if (match.status === 'collected') {
        const advRes  = await fetch(`${API_BASE}/api/sample-status/advance`, {
          method: 'POST',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_ids: [match.id], status: 'received' }),
        });
        if (advRes.ok) {
          const advData = await advRes.json().catch(() => ({}));
          if (advData.updated) {
            setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'advanced', detail: `${match.patient_name}${match.test_name ? ` (${match.test_name})` : ''} → Received` }, ...prev].slice(0, 30));
          } else {
            setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'not_found', detail: 'Nothing was updated' }, ...prev].slice(0, 30));
          }
        } else {
          setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'not_found', detail: 'Could not update' }, ...prev].slice(0, 30));
        }
      } else {
        setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'skipped', detail: `Already ${match.status} — no change` }, ...prev].slice(0, 30));
      }
    } catch (e: any) {
      setScanLog(prev => [{ id: `${Date.now()}`, code, outcome: 'not_found', detail: e.message ?? 'Error' }, ...prev].slice(0, 30));
    } finally {
      setScanCode('');
      setScanBusy(false);
      scanInputRef.current?.focus();
    }
  };

  const openCameraScanner = () => {
    cameraLockRef.current = false;
    scanBridge.clear(); // drop any stale code from a previous abandoned scan
    router.push('/scan-camera');
  };

  return (
    <View style={styles.container}>
      {/* Mode tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, mode === 'search' && styles.tabActive]} onPress={() => setMode('search')}>
          <Text style={[styles.tabText, mode === 'search' && styles.tabTextActive]}>🔍  Search</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === 'scan' && styles.tabActive]} onPress={() => { setMode('scan'); setTimeout(() => scanInputRef.current?.focus(), 100); }}>
          <Text style={[styles.tabText, mode === 'scan' && styles.tabTextActive]}>📷  Scan Mode</Text>
        </TouchableOpacity>
      </View>

      {mode === 'search' ? (
        <>
          {/* Search fields */}
          <View style={styles.searchFieldsCard}>
            <Text style={styles.fieldLabel}>Barcode</Text>
            <TextInput style={styles.fieldInput} value={barcode} onChangeText={setBarcode}
              placeholder="e.g. HC58922" placeholderTextColor="#94A3B8"
              onSubmitEditing={searchSamples} returnKeyType="search" />

            <Text style={[styles.fieldLabel, { marginTop: 12 }]}>Accession No.</Text>
            <TextInput style={styles.fieldInput} value={accession} onChangeText={setAccession}
              placeholder="e.g. HC58922A" placeholderTextColor="#94A3B8"
              onSubmitEditing={searchSamples} returnKeyType="search" />

            <TouchableOpacity style={styles.searchBtn} onPress={searchSamples} disabled={searching}>
              {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.searchBtnText}>Search</Text>}
            </TouchableOpacity>
          </View>

          {/* Advance buttons */}
          {selected.length > 0 && (
            <View style={styles.advanceBar}>
              <Text style={styles.selectedCount}>{selected.length} selected · advance to:</Text>
              <View style={styles.advanceBtns}>
                {STATUS_FLOW.map(s => (
                  <TouchableOpacity key={s.key} style={[styles.advBtn, { borderColor: s.color }]}
                    onPress={() => advance(s.key)} disabled={advancing}>
                    <Text style={[styles.advBtnText, { color: s.color }]}>{s.label.split(' ')[1]}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[styles.advBtn, { borderColor: '#8B5CF6' }]}
                  onPress={() => advance('outsource')} disabled={advancing}>
                  <Text style={[styles.advBtnText, { color: '#8B5CF6' }]}>📤 Outsource</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.advBtn, { borderColor: '#EF4444' }]} onPress={reject} disabled={advancing}>
                  <Text style={[styles.advBtnText, { color: '#EF4444' }]}>Reject</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Results */}
          {searching ? <ActivityIndicator color="#17B9A1" style={{ marginTop: 48 }} /> : (
            <FlatList data={results} keyExtractor={r => r.id.toString()}
              contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
              renderItem={({ item: r }) => {
                const isSel = selected.includes(r.id);
                const color = STATUS_COLOR[r.status] ?? '#64748B';
                return (
                  <TouchableOpacity style={[styles.card, isSel && styles.cardSelected]} onPress={() => toggleSelect(r.id)}>
                    <View style={styles.cardRow}>
                      <View style={styles.checkbox}>
                        {isSel && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.patName}>{r.patient_name}{r.test_name ? ` · ${r.test_name}` : ''}</Text>
                        <Text style={styles.barcode}>{r.barcode}{r.accession_number ? ` · ${r.accession_number}` : ''}{r.package_name ? ` · ${r.package_name}` : ''}</Text>
                      </View>
                      <View style={[styles.badge, { borderColor: color }]}>
                        <Text style={[styles.badgeText, { color }]}>{statusLabel(r.status)}</Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyIcon}>🔍</Text>
                  <Text style={styles.emptyText}>Search a barcode or accession no. to begin</Text>
                </View>
              }
            />
          )}
        </>
      ) : (
        <>
          {/* Scan Mode */}
          <View style={styles.scanCard}>
            <Text style={styles.scanHint}>
              Every scan moves that sample straight to <Text style={{ fontWeight: '700', color: '#06B6D4' }}>Received</Text> — but
              only if it's currently <Text style={{ fontWeight: '700', color: '#3B82F6' }}>Collected</Text>. Anything already
              further along (tested, validated, reported...) is left untouched.
            </Text>

            <TouchableOpacity style={styles.cameraScanBtn} onPress={openCameraScanner} disabled={scanBusy}>
              <Text style={styles.cameraScanBtnIcon}>📷</Text>
              <Text style={styles.cameraScanBtnText}>Scan with Camera</Text>
            </TouchableOpacity>

            <Text style={styles.scanOrDivider}>— or use a scanner / type manually —</Text>

            <TextInput ref={scanInputRef} style={styles.scanInput} value={scanCode} onChangeText={setScanCode}
              placeholder="Scan barcode / accession label..." placeholderTextColor="#94A3B8"
              onSubmitEditing={() => handleScan()} returnKeyType="search" autoFocus
              editable={!scanBusy} blurOnSubmit={false} />
            {scanBusy && <ActivityIndicator color="#17B9A1" style={{ marginTop: 8 }} />}
          </View>

          <FlatList data={scanLog} keyExtractor={item => item.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
            renderItem={({ item }) => {
              const color = item.outcome === 'advanced' ? '#06B6D4' : item.outcome === 'skipped' ? '#F59E0B' : '#EF4444';
              const icon  = item.outcome === 'advanced' ? '✅' : item.outcome === 'skipped' ? '⏭' : '❌';
              return (
                <View style={[styles.scanLogRow, { borderColor: color }]}>
                  <Text style={styles.scanLogIcon}>{icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scanLogCode}>{item.code}</Text>
                    <Text style={[styles.scanLogDetail, { color }]}>{item.detail}</Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>📷</Text>
                <Text style={styles.emptyText}>Scan a barcode or accession label to begin</Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F8FAFC' },
  tabRow:          { flexDirection: 'row', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingTop: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', gap: 8 },
  tab:             { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive:       { borderBottomColor: '#17B9A1' },
  tabText:         { fontSize: 14, fontWeight: '600', color: '#64748B' },
  tabTextActive:   { color: '#17B9A1' },

  searchFieldsCard:{ backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  fieldLabel:      { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.4, marginBottom: 6 },
  fieldInput:      { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  searchBtn:       { backgroundColor: '#17B9A1', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  searchBtnText:   { color: '#fff', fontWeight: '700' },

  advanceBar:      { backgroundColor: '#FFFFFF', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  selectedCount:   { color: '#94A3B8', fontSize: 12, marginBottom: 8 },
  advanceBtns:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  advBtn:          { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  advBtnText:      { fontSize: 11, fontWeight: '700' },
  card:            { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  cardSelected:    { borderColor: '#17B9A1', backgroundColor: '#17B9A115' },
  cardRow:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox:        { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  checkmark:       { color: '#17B9A1', fontWeight: 'bold' },
  patName:         { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  barcode:         { color: '#64748B', fontSize: 11 },
  badge:           { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  badgeText:       { fontSize: 10, fontWeight: '700' },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12, textAlign: 'center', paddingHorizontal: 24 },

  scanCard:        { backgroundColor: '#FFFFFF', margin: 12, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  scanHint:        { fontSize: 12.5, color: '#64748B', lineHeight: 18, marginBottom: 12 },
  cameraScanBtn:   { flexDirection: 'row', backgroundColor: '#17B9A1', paddingVertical: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', gap: 8 },
  cameraScanBtnIcon:{ fontSize: 18 },
  cameraScanBtnText:{ color: '#fff', fontWeight: '700', fontSize: 15 },
  scanOrDivider:   { textAlign: 'center', color: '#94A3B8', fontSize: 11, marginVertical: 12 },
  scanInput:       { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 14, borderRadius: 10, fontSize: 15, borderWidth: 1.5, borderColor: '#17B9A1' },
  scanLogRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1 },
  scanLogIcon:     { fontSize: 18 },
  scanLogCode:     { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  scanLogDetail:   { fontSize: 12, marginTop: 2, fontWeight: '600' },

  // Camera scanner modal
  // Camera scanner styles now live in src/app/scan-camera.tsx
});
