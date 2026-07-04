import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, ScrollView, Alert, Platform,
} from 'react-native';

interface ValidatedReport {
  id: number; barcode: string; patient_name: string; age?: number | null; gender?: string;
  status: string; needs_history: boolean; assigned_doctor_id?: number | null;
  organization_id?: number | null; created_at: string; validated_at?: string | null;
}
interface Param { name: string; value: number | string; unit?: string; ref_min?: number; ref_max?: number; flag?: string; }
interface ResultItem { id: number; test_name: string; status: string; created_at: string; parsed_data?: { protocol?: string; parameters?: Param[] }; }
interface HistoryTrail { id: number; asked_for: string[]; note?: string | null; status: string; answer?: string | null; answer_checklist?: string[]; created_at: string; answered_at?: string | null; }
interface ReportDetail extends ValidatedReport {
  doctor_name?: string; clinical_history?: string; history_checklist?: Record<string, boolean>;
  validated_by?: number; results?: ResultItem[]; open_history_request?: any; history_trail?: HistoryTrail[];
}

const CHECKLIST_LABELS: Record<string, string> = {
  diabetic: 'Diabetic?', fasting_sample: 'Fasting sample?', on_medication: 'On medication?',
  hypertension: 'Hypertension?', pregnant: 'Pregnant?',
};
const FLAG_COLOR: Record<string, string> = { H: '#EF4444', L: '#3B82F6' };

const toYMD = (d: Date) => { const p = (n: number) => n.toString().padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '—';

export default function ValidateHistory() {
  const [items, setItems]           = useState<ValidatedReport[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);

  // Read-only detail modal
  const [sel, setSel]               = useState<ReportDetail | null>(null);
  const [selLoading, setSelLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState<number | null>(null);

  const fetchValidated = useCallback(async (from?: string, to?: string) => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('date_from', from);
      if (to)   params.set('date_to', to);
      const qs = params.toString();
      const res  = await fetch(`${API_BASE}/api/reports/validated${qs ? `?${qs}` : ''}`, { headers: authHeader() });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchValidated(); }, []); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchValidated(fromDate, toDate); };
  const applyFilters = () => { setLoading(true); fetchValidated(fromDate, toDate); };
  const resetFilters = () => { setFromDate(''); setToDate(''); setLoading(true); fetchValidated(); };

  const openDetail = async (id: number) => {
    setSelLoading(true); setSel(null);
    try {
      const res  = await fetch(`${API_BASE}/api/reports/${id}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { Alert.alert('Error', data.detail ?? 'Could not load report'); return; }
      setSel(data);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSelLoading(false); }
  };

  const closeDetail = () => setSel(null);

  const viewPDF = async (resultId: number, barcode: string) => {
    setPdfLoading(resultId);
    try {
      const tok = getToken();
      const fileUri = FileSystem.cacheDirectory + `Report_${barcode}_${resultId}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/results/${resultId}/pdf`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Report not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Report ${barcode}` });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPdfLoading(null); }
  };

  const activeFilterCount = [fromDate, toDate].filter(Boolean).length;

  const renderItem = ({ item }: { item: ValidatedReport }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDetail(item.id)} activeOpacity={0.8}>
      <View style={styles.cardTop}>
        <Text style={styles.barcode}>{item.barcode}</Text>
        <View style={styles.statusBadge}><Text style={styles.statusText}>{item.status}</Text></View>
      </View>
      <Text style={styles.patientName}>{item.patient_name}</Text>
      <Text style={styles.meta}>{item.age ?? '—'} / {item.gender ?? '—'}  ·  Registered {fmtDate(item.created_at)}</Text>
      <Text style={styles.validatedMeta}>✓ Validated {fmtDate(item.validated_at)}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Date range filter */}
      <View style={styles.filterBar}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.filterLabel}>From</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowFromPicker(true)}>
            <Text style={{ color: fromDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{fromDate || 'Any'}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.filterLabel}>To</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowToPicker(true)}>
            <Text style={{ color: toDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{toDate || 'Any'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
          <Text style={styles.applyBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>
      {activeFilterCount > 0 && (
        <TouchableOpacity onPress={resetFilters} style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <Text style={styles.resetText}>✕ Clear date filter</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={items}
        keyExtractor={(it) => it.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
        ListHeaderComponent={!loading ? (
          <Text style={styles.headerCount}>{items.length} report{items.length !== 1 ? 's' : ''} validated{activeFilterCount > 0 ? ' in range' : ''}</Text>
        ) : null}
        ListEmptyComponent={loading ? (
          <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} />
        ) : (
          <View style={styles.empty}><Text style={styles.emptyIcon}>📖</Text><Text style={styles.emptyText}>No validated reports{activeFilterCount > 0 ? ' in this range' : ''}</Text></View>
        )}
      />

      {/* Read-only detail modal */}
      <Modal visible={!!sel || selLoading} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {selLoading || !sel ? (
              <ActivityIndicator color="#0EA5E9" size="large" style={{ marginVertical: 40 }} />
            ) : (
              <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>{sel.patient_name}</Text>
                <Text style={styles.modalSub}>{sel.barcode} · {sel.age ?? '—'} / {sel.gender ?? '—'}</Text>
                <View style={styles.validatedPill}>
                  <Text style={styles.validatedPillText}>✓ Validated {fmtDate(sel.validated_at)}</Text>
                </View>

                {(sel.history_trail ?? []).length > 0 && (
                  <View style={{ marginTop: 16 }}>
                    {sel.history_trail!.map(h => (
                      <View key={h.id} style={styles.trailRow}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.trailLabel}>{h.asked_for.map(k => CHECKLIST_LABELS[k] ?? k).join(', ')}</Text>
                          {!!h.answer && <Text style={styles.trailAnswer} numberOfLines={2}>"{h.answer}"</Text>}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <View style={[styles.trailBadge, h.status === 'answered' ? styles.trailBadgeAnswered : styles.trailBadgePending]}>
                            <Text style={styles.trailBadgeText}>{h.status.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.trailDate}>{fmtDate(h.created_at)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                <Text style={styles.sectionLabel}>Results</Text>
                {(sel.results ?? []).map(r => (
                  <View key={r.id} style={styles.resultCard}>
                    <View style={styles.resultHeader}>
                      <Text style={styles.resultName} numberOfLines={2}>{r.test_name}</Text>
                      <TouchableOpacity style={styles.pdfBtn} onPress={() => viewPDF(r.id, sel.barcode)} disabled={pdfLoading === r.id}>
                        <Text style={styles.pdfBtnText}>{pdfLoading === r.id ? 'Loading…' : '📄 View Full Report (PDF)'}</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.paramHeaderRow}>
                      <Text style={[styles.paramHeaderText, { flex: 1.6 }]}>PARAMETER</Text>
                      <Text style={[styles.paramHeaderText, { flex: 1 }]}>RESULT</Text>
                      <Text style={[styles.paramHeaderText, { flex: 0.8 }]}>UNIT</Text>
                      <Text style={[styles.paramHeaderText, { flex: 1.2 }]}>RANGE</Text>
                      <Text style={[styles.paramHeaderText, { flex: 0.6, textAlign: 'right' }]}>FLAG</Text>
                    </View>
                    {(r.parsed_data?.parameters ?? []).map((p, idx) => (
                      <View key={idx} style={styles.paramRow}>
                        <Text style={[styles.paramText, { flex: 1.6, fontWeight: '600', color: '#F1F5F9' }]}>{p.name}</Text>
                        <Text style={[styles.paramText, { flex: 1 }]}>{p.value}</Text>
                        <Text style={[styles.paramText, { flex: 0.8 }]}>{p.unit ?? '—'}</Text>
                        <Text style={[styles.paramText, { flex: 1.2 }]}>{p.ref_min ?? '—'}–{p.ref_max ?? '—'}</Text>
                        <Text style={[styles.paramText, { flex: 0.6, textAlign: 'right', color: FLAG_COLOR[p.flag ?? ''] ?? '#94A3B8', fontWeight: '700' }]}>{p.flag ?? '—'}</Text>
                      </View>
                    ))}
                  </View>
                ))}
                {(sel.results ?? []).length === 0 && (
                  <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>No results</Text>
                )}
                <View style={{ height: 12 }} />
              </ScrollView>
            )}

            {!selLoading && sel && (
              <TouchableOpacity style={styles.closeBtn} onPress={closeDetail}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {showFromPicker && (
        <DateTimePicker value={fromDate ? new Date(fromDate) : new Date()} mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => { setShowFromPicker(false); if (d) setFromDate(toYMD(d)); }} />
      )}
      {showToPicker && (
        <DateTimePicker value={toDate ? new Date(toDate) : new Date()} mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => { setShowToPicker(false); if (d) setToDate(toYMD(d)); }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  filterBar:       { flexDirection: 'row', alignItems: 'flex-end', padding: 12, paddingBottom: 4 },
  filterLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  dateBtn:         { backgroundColor: '#1E293B', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  applyBtn:        { backgroundColor: '#8B5CF6', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  applyBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  resetText:       { color: '#EF4444', fontSize: 12 },
  headerCount:     { color: '#64748B', fontSize: 13, marginBottom: 10 },
  card:            { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barcode:         { color: '#0EA5E9', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  statusBadge:     { backgroundColor: '#10B98133', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:      { color: '#10B981', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  patientName:     { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginTop: 8 },
  meta:            { color: '#64748B', fontSize: 12, marginTop: 4 },
  validatedMeta:   { color: '#10B981', fontSize: 11, fontWeight: '600', marginTop: 6 },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12, textAlign: 'center' },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalTitle:      { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  modalSub:        { color: '#64748B', fontSize: 12, marginTop: 3 },
  validatedPill:   { alignSelf: 'flex-start', backgroundColor: '#10B98133', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginTop: 10 },
  validatedPillText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  sectionLabel:    { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  trailRow:        { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#0F172A', borderRadius: 10, padding: 10, marginBottom: 6 },
  trailLabel:      { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  trailAnswer:     { color: '#64748B', fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  trailBadge:      { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  trailBadgeAnswered: { backgroundColor: '#10B98133' },
  trailBadgePending:  { backgroundColor: '#F59E0B33' },
  trailBadgeText:  { fontSize: 9, fontWeight: '700', color: '#10B981' },
  trailDate:       { color: '#475569', fontSize: 10, marginTop: 4 },
  resultCard:      { backgroundColor: '#0F172A', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  resultHeader:    { marginBottom: 8 },
  resultName:      { color: '#F1F5F9', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  pdfBtn:          { backgroundColor: '#1E40AF', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  pdfBtnText:      { color: '#fff', fontSize: 11, fontWeight: '700' },
  paramHeaderRow:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#334155', paddingBottom: 6, marginTop: 4 },
  paramHeaderText: { color: '#475569', fontSize: 9, fontWeight: '700' },
  paramRow:        { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  paramText:       { color: '#94A3B8', fontSize: 12 },
  closeBtn:        { marginTop: 16, padding: 12, alignItems: 'center', backgroundColor: '#0F172A', borderRadius: 10 },
  closeBtnText:    { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
});
