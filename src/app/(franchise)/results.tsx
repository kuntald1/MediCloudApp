import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import { router } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, ScrollView,
} from 'react-native';

interface Param  { name: string; value: number | string; unit?: string; ref_min?: number; ref_max?: number; flag?: string; }
interface Result {
  id: number; barcode: string; patient_name: string;
  test_name?: string; status: string; lifecycle_status?: string;
  created_at: string; device_name?: string; franchise?: string;
  over_limit?: boolean; locked?: boolean;
  parsed_data?: { parameters?: Param[]; protocol?: string } | null;
}

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B', collected: '#3B82F6', tested: '#F97316',
  validated: '#A855F7', reported: '#10B981', completed: '#10B981',
  sample_rejected: '#EF4444', rejected: '#EF4444',
};

const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '';

export default function FranchiseResults() {
  const [results, setResults]       = useState<Result[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [barcode, setBarcode]       = useState('');
  const [patientId, setPatientId]   = useState('');

  // Detail modal
  const [sel, setSel]               = useState<Result | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<number | null>(null);

  const fetchResults = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (barcode.trim())   params.set('barcode', barcode.trim());
      if (patientId.trim()) params.set('patient_id', patientId.trim());
      const res  = await fetch(`${API_BASE}/api/results/?${params.toString()}`, { headers: authHeader() });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [barcode, patientId]);

  // Load only this franchise's reports on mount (server scopes it)
  useEffect(() => { fetchResults(); }, []); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchResults(); };
  const applySearch = () => { setLoading(true); fetchResults(); };
  const clearSearch = () => { setBarcode(''); setPatientId(''); setLoading(true); setTimeout(fetchResults, 50); };

  const showLockedAlert = () => {
    Alert.alert(
      '🔒 Report Locked',
      'This report is locked because your outstanding balance has crossed the credit limit. Clear the due amount to view report details and download the PDF.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Manage Credit →', onPress: () => router.push('/(franchise)/manage-credit' as any) },
      ]
    );
  };

  const openDetail = async (r: Result) => {
    if (r.locked) { showLockedAlert(); return; }
    setSel(r); setSelLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/results/${r.id}`, { headers: authHeader() });
      if (res.ok) {
        const data = await res.json();
        // Merge onto the list item rather than replacing it — the detail
        // endpoint's response shape isn't guaranteed to repeat every field
        // (e.g. it may omit patient_name/device_name), so we keep whichever
        // value is actually present instead of letting a missing key blank
        // out something we already know from the list.
        setSel(prev => {
          const base = prev ?? r;
          return {
            ...base,
            ...data,
            patient_name:     data?.patient_name     ?? base.patient_name,
            barcode:          data?.barcode           ?? base.barcode,
            device_name:      data?.device_name       ?? base.device_name,
            test_name:        data?.test_name         ?? base.test_name,
            status:           data?.status            ?? base.status,
            lifecycle_status: data?.lifecycle_status  ?? base.lifecycle_status,
            created_at:       data?.created_at        ?? base.created_at,
            parsed_data:      data?.parsed_data
                               ?? (data?.protocol || data?.parameters
                                    ? { protocol: data.protocol, parameters: data.parameters }
                                    : base.parsed_data),
          };
        });
      }
    } catch (e) { /* keep the list item as a fallback */ }
    finally { setSelLoading(false); }
  };

  const closeDetail = () => setSel(null);

  const viewPDF = async (r: Result) => {
    if (r.locked) { showLockedAlert(); return; }
    if (!r.id) { Alert.alert('Error', 'No report id'); return; }
    setPdfLoading(r.id);
    try {
      const tok = getToken();
      const fileUri = FileSystem.cacheDirectory + `Report_${r.barcode}_${r.id}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/results/${r.id}/pdf`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Report not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Report ${r.barcode}` });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setPdfLoading(null); }
  };

  const activeFilterCount = [barcode, patientId].filter(s => s.trim()).length;

  const renderItem = ({ item: r }: { item: Result }) => {
    const life  = r.lifecycle_status ?? r.status;
    const color = STATUS_COLOR[life] ?? '#64748B';
    const statusColor = STATUS_COLOR[r.status] ?? '#64748B';
    return (
      <TouchableOpacity style={styles.card} onPress={() => openDetail(r)} activeOpacity={0.8}>
        <View style={styles.cardRow}>
          <Text style={styles.name} numberOfLines={1}>{r.patient_name}</Text>
          {r.locked && <Text style={styles.lock}>🔒</Text>}
        </View>
        <Text style={styles.testName}>
          {r.test_name ?? '—'} <Text style={styles.barcodeInline}>· {r.barcode}</Text>
        </Text>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>{life}</Text>
          </View>
          <View style={[styles.badge, { borderColor: statusColor }]}>
            <Text style={[styles.badgeText, { color: statusColor }]}>{r.status}</Text>
          </View>
          {r.over_limit && (
            <View style={[styles.badge, { borderColor: '#F59E0B' }]}>
              <Text style={[styles.badgeText, { color: '#F59E0B' }]}>over limit</Text>
            </View>
          )}
        </View>
        <Text style={styles.date}>{fmtDateTime(r.created_at)}{r.device_name ? ` · ${r.device_name}` : ''}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search filters */}
      <View style={styles.searchWrap}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Barcode</Text>
            <TextInput style={styles.input} value={barcode} onChangeText={setBarcode}
              placeholder="e.g. DEMO-1-5E" placeholderTextColor="#475569"
              onSubmitEditing={applySearch} returnKeyType="search" autoCapitalize="characters" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Patient ID</Text>
            <TextInput style={styles.input} value={patientId} onChangeText={setPatientId}
              placeholder="e.g. 203" placeholderTextColor="#475569"
              onSubmitEditing={applySearch} returnKeyType="search" keyboardType="numeric" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 10, gap: 10 }}>
          <TouchableOpacity style={styles.searchBtn} onPress={applySearch}>
            <Text style={styles.searchBtnText}>🔍 Search</Text>
          </TouchableOpacity>
          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearSearch}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!loading && <Text style={styles.headerCount}>{results.length} result{results.length !== 1 ? 's' : ''} — tap to view details</Text>}

      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={results} keyExtractor={(r, i) => (r.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>📋</Text><Text style={styles.emptyText}>No results found</Text></View>}
        />
      )}

      {/* Detail modal — mirrors the web "Lab Report" side panel */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {sel && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Lab Report</Text>
                    <Text style={styles.modalSub}>Result #{sel.id}</Text>
                  </View>
                  <TouchableOpacity onPress={closeDetail} style={styles.closeX}>
                    <Text style={styles.closeXText}>✕</Text>
                  </TouchableOpacity>
                </View>

                {selLoading ? <ActivityIndicator color="#0EA5E9" style={{ marginVertical: 24 }} /> : (
                  <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                    <View style={styles.infoGrid}>
                      <View style={styles.infoBox}>
                        <Text style={styles.infoLabel}>PATIENT</Text>
                        <Text style={styles.infoVal}>{sel.patient_name}</Text>
                      </View>
                      <View style={styles.infoBox}>
                        <Text style={styles.infoLabel}>BARCODE</Text>
                        <Text style={styles.infoVal}>{sel.barcode}</Text>
                      </View>
                      <View style={styles.infoBox}>
                        <Text style={styles.infoLabel}>DEVICE</Text>
                        <Text style={styles.infoVal}>{sel.device_name ?? '—'}</Text>
                      </View>
                      <View style={styles.infoBox}>
                        <Text style={styles.infoLabel}>PROTOCOL</Text>
                        <Text style={styles.infoVal}>{sel.parsed_data?.protocol ?? '—'}</Text>
                      </View>
                    </View>

                    <Text style={styles.paramTitle}>PARAMETERS ({sel.parsed_data?.parameters?.length ?? 0})</Text>
                    {(sel.parsed_data?.parameters ?? []).map((p, i) => {
                      const flag = p.flag === 'H' || p.flag === 'L';
                      return (
                        <View key={i} style={styles.paramRow}>
                          <Text style={styles.paramName}>{p.name}</Text>
                          <Text style={[styles.paramValue, flag && { color: '#EF4444', fontWeight: '700' }]}>
                            {p.value}{p.unit ? ` ${p.unit}` : ''}{p.flag ? ` ${p.flag === 'H' ? '↑' : '↓'}` : ''}
                          </Text>
                          {(p.ref_min != null || p.ref_max != null) && (
                            <Text style={styles.paramRef}>{p.ref_min}–{p.ref_max}</Text>
                          )}
                        </View>
                      );
                    })}

                    <TouchableOpacity style={styles.pdfBtn} onPress={() => viewPDF(sel)} disabled={pdfLoading === sel.id}>
                      <Text style={styles.pdfBtnText}>{pdfLoading === sel.id ? 'Loading…' : '📄 Download PDF'}</Text>
                    </TouchableOpacity>
                    <View style={{ height: 8 }} />
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F172A' },
  searchWrap:     { padding: 12, paddingBottom: 4 },
  fieldLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  input:          { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 11, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  searchBtn:      { flex: 1, backgroundColor: '#F97316', padding: 12, borderRadius: 10, alignItems: 'center' },
  searchBtnText:  { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn:       { paddingHorizontal: 16, justifyContent: 'center' },
  clearBtnText:   { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  headerCount:    { color: '#64748B', fontSize: 12, marginHorizontal: 12, marginBottom: 8, marginTop: 4 },
  card:           { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name:           { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', flex: 1 },
  lock:           { fontSize: 14, marginLeft: 6 },
  testName:       { color: '#60A5FA', fontSize: 12, marginTop: 4 },
  barcodeInline:  { color: '#F97316', fontSize: 12 },
  badgeRow:       { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:      { fontSize: 10, fontWeight: '700' },
  date:           { color: '#475569', fontSize: 11, marginTop: 8 },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  modalSub:       { color: '#64748B', fontSize: 12, marginTop: 2 },
  closeX:         { padding: 6 },
  closeXText:     { color: '#64748B', fontSize: 16 },
  infoGrid:       { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#0F172A', borderRadius: 10, padding: 12, gap: 14 },
  infoBox:        { width: '45%' },
  infoLabel:      { color: '#475569', fontSize: 10, fontWeight: '700', marginBottom: 3 },
  infoVal:        { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  paramTitle:     { color: '#475569', fontSize: 11, fontWeight: '700', marginTop: 16, marginBottom: 6, textTransform: 'uppercase' },
  paramRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#0F172A' },
  paramName:      { flex: 1, color: '#94A3B8', fontSize: 12 },
  paramValue:     { color: '#F1F5F9', fontSize: 13, fontWeight: '600', marginRight: 8 },
  paramRef:       { color: '#475569', fontSize: 10, width: 60, textAlign: 'right' },
  pdfBtn:         { backgroundColor: '#F97316', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  pdfBtnText:     { color: '#fff', fontSize: 13, fontWeight: '700' },
});
