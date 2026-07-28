import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, ScrollView, TextInput, Alert, Switch,
} from 'react-native';

interface PendingReport {
  id: number; barcode: string; patient_name: string; age?: number | null; gender?: string;
  status: string; needs_history: boolean; assigned_doctor_id?: number | null;
  organization_id?: number | null; created_at: string; accession_numbers?: string[];
}
interface Param { name: string; value: number | string; unit?: string; ref_min?: number; ref_max?: number; flag?: string; }
interface ResultItem { id: number; test_name: string; status: string; created_at: string; accession_number?: string; note?: string | null; parsed_data?: { protocol?: string; parameters?: Param[] }; }
interface HistoryTrail { id: number; asked_for: string[]; note?: string | null; status: string; answer?: string | null; answer_checklist?: string[]; created_at: string; answered_at?: string | null; }
interface ReportDetail extends PendingReport {
  doctor_name?: string; clinical_history?: string; history_checklist?: Record<string, boolean>;
  validated_by?: number; validated_at?: string;
  results?: ResultItem[]; open_history_request?: any; history_trail?: HistoryTrail[];
}

// Same checklist keys used on the lab side's History Needed screen — keep in sync.
const CHECKLIST_LABELS: Record<string, string> = {
  diabetic: 'Diabetic?', fasting_sample: 'Fasting sample?', on_medication: 'On medication?',
  hypertension: 'Hypertension?', pregnant: 'Pregnant?',
};

const FLAG_COLOR: Record<string, string> = { H: '#EF4444', L: '#3B82F6' };
const FLAG_OPTIONS = [
  { label: 'Normal', value: '' },
  { label: 'High',   value: 'H' },
  { label: 'Low',    value: 'L' },
];
const POLL_MS = 8000;

const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '—';

export default function ReportValidate() {
  const [items, setItems]           = useState<PendingReport[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Review modal
  const [sel, setSel]                       = useState<ReportDetail | null>(null);
  const [selLoading, setSelLoading]         = useState(false);
  const [panel, setPanel]                   = useState<'review' | 'history'>('review');
  const [validating, setValidating]         = useState(false);
  const [sendingHistory, setSendingHistory] = useState(false);
  const [checklist, setChecklist]           = useState<Record<string, boolean>>({});
  const [note, setNote]                     = useState('');
  const [pdfLoading, setPdfLoading]         = useState<number | null>(null);

  // Editing a single result's parameters/note (lab-report-style, doctor may
  // correct a value before validating)
  const [editingResultId, setEditingResultId] = useState<number | null>(null);
  const [editParams, setEditParams]           = useState<Param[]>([]);
  const [editNote, setEditNote]               = useState('');
  const [savingEdit, setSavingEdit]           = useState(false);

  const fetchPending = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/reports/pending`, { headers: authHeader() });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  // Auto-refresh the list every few seconds while this screen is mounted
  useEffect(() => {
    fetchPending();
    timer.current = setInterval(fetchPending, POLL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [fetchPending]);

  const onRefresh = () => { setRefreshing(true); fetchPending(); };

  const openReview = async (id: number) => {
    setSelLoading(true); setPanel('review'); setChecklist({}); setNote(''); setSel(null);
    try {
      const res  = await fetch(`${API_BASE}/api/reports/${id}`, { headers: authHeader() });
      const data = await res.json();
      if (!res.ok) { Alert.alert('Error', data.detail ?? 'Could not load report'); return; }
      setSel(data);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSelLoading(false); }
  };

  const closeReview = () => { setSel(null); setPanel('review'); setEditingResultId(null); };

  // Download the result PDF with auth token → open share sheet
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

  const startEditResult = (r: ResultItem) => {
    setEditingResultId(r.id);
    setEditParams((r.parsed_data?.parameters ?? []).map(p => ({ ...p })));
    setEditNote(r.note ?? '');
  };
  const cancelEditResult = () => setEditingResultId(null);

  const setEditParamValue = (i: number, v: string) =>
    setEditParams(prev => prev.map((p, idx) => idx === i ? { ...p, value: v } : p));
  const setEditParamFlag = (i: number, flag: string) =>
    setEditParams(prev => prev.map((p, idx) => idx === i ? { ...p, flag } : p));

  const saveEditResult = async (resultId: number) => {
    setSavingEdit(true);
    try {
      const payload = {
        parameters: editParams.map(p => ({
          name: p.name,
          value: isNaN(Number(p.value)) ? p.value : Number(p.value),
          unit: p.unit, ref_min: p.ref_min, ref_max: p.ref_max, flag: p.flag || undefined,
        })),
        note: editNote,
      };
      const res  = await fetch(`${API_BASE}/api/results/${resultId}`, {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? 'Could not save changes');
      // Merge the updated parameters/note back onto the currently-open report
      setSel(prev => prev ? {
        ...prev,
        results: (prev.results ?? []).map(r => r.id === resultId
          ? { ...r, parsed_data: data.parsed_data ?? r.parsed_data, note: data.note ?? editNote }
          : r),
      } : prev);
      setEditingResultId(null);
      Alert.alert('✅ Saved', 'Result updated');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setSavingEdit(false); }
  };

  const validateReport = async () => {
    if (!sel) return;
    setValidating(true);
    try {
      const res  = await fetch(`${API_BASE}/api/reports/${sel.id}/validate`, { method: 'POST', headers: authHeader() });
      const data = await res.json();
      if (res.ok && data.ok) {
        Alert.alert('✅ Validated', 'Report has been validated and sent for reporting.');
        closeReview();
        fetchPending();
      } else {
        Alert.alert('Error', data.detail ?? 'Could not validate report');
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setValidating(false); }
  };

  const toggleCheck = (key: string) => setChecklist(c => ({ ...c, [key]: !c[key] }));

  const sendHistoryRequest = async () => {
    if (!sel) return;
    const checked = Object.fromEntries(Object.entries(checklist).filter(([, v]) => v));
    if (Object.keys(checked).length === 0 && !note.trim()) {
      Alert.alert('Nothing selected', 'Choose at least one item or add a note'); return;
    }
    setSendingHistory(true);
    try {
      const res  = await fetch(`${API_BASE}/api/reports/${sel.id}/need-history`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ checklist: checked, note: note.trim() || null }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Mirrors the web behaviour: patients under a franchise get a WhatsApp
        // notification (org_notified), patients under a branch only get the
        // lab notification bell.
        Alert.alert('✅ Request sent', data.org_notified
          ? 'The franchise has been notified via WhatsApp.'
          : 'The lab has been notified.');
        closeReview();
        fetchPending();
      } else {
        Alert.alert('Error', data.detail ?? 'Could not send request');
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSendingHistory(false); }
  };

  const renderItem = ({ item }: { item: PendingReport }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.barcode}>{item.barcode}{item.accession_numbers && item.accession_numbers.length > 0 ? ` · ${item.accession_numbers.join(', ')}` : ''}</Text>
        <View style={styles.statusBadge}><Text style={styles.statusText}>{item.status}</Text></View>
      </View>
      <Text style={styles.patientName}>{item.patient_name}</Text>
      <Text style={styles.meta}>{item.age ?? '—'} / {item.gender ?? '—'}  ·  Registered {fmtDate(item.created_at)}</Text>
      {item.needs_history && <Text style={styles.historyFlag}>📜 History requested</Text>}
      <TouchableOpacity style={styles.reviewBtn} onPress={() => openReview(item.id)}>
        <Text style={styles.reviewBtnText}>Review</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}
        ListHeaderComponent={!loading ? (
          <Text style={styles.headerCount}>{items.length} report{items.length !== 1 ? 's' : ''} awaiting your validation</Text>
        ) : null}
        ListEmptyComponent={loading ? (
          <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} />
        ) : (
          <View style={styles.empty}><Text style={styles.emptyIcon}>🩺</Text><Text style={styles.emptyText}>No reports awaiting validation</Text></View>
        )}
      />

      {/* Review / Need-more-history modal */}
      <Modal visible={!!sel || selLoading} transparent animationType="slide" onRequestClose={closeReview}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {selLoading || !sel ? (
              <ActivityIndicator color="#17B9A1" size="large" style={{ marginVertical: 40 }} />
            ) : panel === 'review' ? (
              <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>{sel.patient_name}</Text>
                <Text style={styles.modalSub}>{sel.barcode} · {sel.age ?? '—'} / {sel.gender ?? '—'}</Text>

                {/* History request trail */}
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

                {/* Results */}
                <Text style={styles.sectionLabel}>Results</Text>
                {(sel.results ?? []).map(r => {
                  const isEditing = editingResultId === r.id;
                  return (
                    <View key={r.id} style={[styles.resultCard, isEditing && styles.resultCardEditing]}>
                      <View style={styles.resultHeader}>
                        <Text style={styles.resultName} numberOfLines={2}>
                          {r.test_name}{r.accession_number ? <Text style={styles.accessionTag}>  ·  {r.accession_number}</Text> : null}
                        </Text>
                        {!isEditing && (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <TouchableOpacity style={styles.editResultBtn} onPress={() => startEditResult(r)}>
                              <Text style={styles.editResultBtnText}>✎ Edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.pdfBtn, { flex: 1 }]} onPress={() => viewPDF(r.id, sel.barcode)} disabled={pdfLoading === r.id}>
                              <Text style={styles.pdfBtnText}>{pdfLoading === r.id ? 'Loading…' : '📄 View Full Report (PDF)'}</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>

                      {!isEditing ? (
                        <>
                          <View style={styles.paramHeaderRow}>
                            <Text style={[styles.paramHeaderText, { flex: 1.6 }]}>PARAMETER</Text>
                            <Text style={[styles.paramHeaderText, { flex: 1 }]}>RESULT</Text>
                            <Text style={[styles.paramHeaderText, { flex: 0.8 }]}>UNIT</Text>
                            <Text style={[styles.paramHeaderText, { flex: 1.2 }]}>RANGE</Text>
                            <Text style={[styles.paramHeaderText, { flex: 0.6, textAlign: 'right' }]}>FLAG</Text>
                          </View>
                          {(r.parsed_data?.parameters ?? []).map((p, idx) => (
                            <View key={idx} style={styles.paramRow}>
                              <Text style={[styles.paramText, { flex: 1.6, fontWeight: '600', color: '#0F172A' }]}>{p.name}</Text>
                              <Text style={[styles.paramText, { flex: 1 }]}>{p.value}</Text>
                              <Text style={[styles.paramText, { flex: 0.8 }]}>{p.unit ?? '—'}</Text>
                              <Text style={[styles.paramText, { flex: 1.2 }]}>{p.ref_min ?? '—'}–{p.ref_max ?? '—'}</Text>
                              <Text style={[styles.paramText, { flex: 0.6, textAlign: 'right', color: FLAG_COLOR[p.flag ?? ''] ?? '#94A3B8', fontWeight: '700' }]}>{p.flag ?? '—'}</Text>
                            </View>
                          ))}
                          {(!r.parsed_data?.parameters || r.parsed_data.parameters.length === 0) && (
                            <Text style={{ color: '#475569', fontSize: 12, marginTop: 6 }}>No parsed parameters</Text>
                          )}
                        </>
                      ) : (
                        <View style={{ marginTop: 4 }}>
                          {editParams.map((p, i) => (
                            <View key={i} style={styles.editParamRow}>
                              <Text style={styles.editParamName}>{p.name}</Text>
                              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                <TextInput style={[styles.editParamInput, { flex: 1 }]} value={String(p.value)}
                                  onChangeText={v => setEditParamValue(i, v)} keyboardType="numeric" />
                                <View style={styles.flagPicker}>
                                  {FLAG_OPTIONS.map(opt => (
                                    <TouchableOpacity key={opt.value} style={[styles.flagOpt, p.flag === opt.value && styles.flagOptSel]}
                                      onPress={() => setEditParamFlag(i, opt.value)}>
                                      <Text style={[styles.flagOptText, p.flag === opt.value && styles.flagOptTextSel]}>{opt.label}</Text>
                                    </TouchableOpacity>
                                  ))}
                                </View>
                              </View>
                              <Text style={styles.editParamRef}>{p.unit ?? ''} · {p.ref_min}–{p.ref_max}</Text>
                            </View>
                          ))}
                          <Text style={styles.noteLabel}>NOTE (shown at the end of the report if filled in)</Text>
                          <TextInput style={styles.noteInputSmall} value={editNote} onChangeText={setEditNote}
                            placeholder="e.g. Confirm fasting status before repeat" placeholderTextColor="#94A3B8"
                            multiline numberOfLines={2} />
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                            <TouchableOpacity style={[styles.saveEditBtn, { flex: 1 }]} onPress={() => saveEditResult(r.id)} disabled={savingEdit}>
                              {savingEdit ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveEditBtnText}>✓ Save</Text>}
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.cancelEditBtn} onPress={cancelEditResult} disabled={savingEdit}>
                              <Text style={styles.cancelEditBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  );
                })}
                {(sel.results ?? []).length === 0 && (
                  <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>No results yet</Text>
                )}

                <View style={{ height: 12 }} />
              </ScrollView>
            ) : (
              <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>Request more history</Text>
                <View style={styles.checklistGrid}>
                  {Object.entries(CHECKLIST_LABELS).map(([key, label]) => (
                    <TouchableOpacity key={key} style={styles.checkRow} onPress={() => toggleCheck(key)} activeOpacity={0.7}>
                      <Switch value={!!checklist[key]} onValueChange={() => toggleCheck(key)}
                        trackColor={{ false: '#E2E8F0', true: '#F59E0B' }} thumbColor="#fff" />
                      <Text style={styles.checkLabel}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>Note (optional)</Text>
                <TextInput style={styles.noteInput} value={note} onChangeText={setNote}
                  placeholder="e.g. Confirm last meal time and any thyroid medication" placeholderTextColor="#475569"
                  multiline numberOfLines={3} textAlignVertical="top" />
                <View style={{ height: 8 }} />
              </ScrollView>
            )}

            {!selLoading && sel && (
              <View style={styles.btnRow}>
                {panel === 'review' ? (
                  <>
                    <TouchableOpacity style={[styles.validateBtn, validating && { opacity: 0.7 }]} onPress={validateReport} disabled={validating}>
                      {validating ? <ActivityIndicator color="#fff" /> : <Text style={styles.validateBtnText}>✓ Validate Report</Text>}
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.historyBtn} onPress={() => setPanel('history')} disabled={validating}>
                      <Text style={styles.historyBtnText}>Need More History</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity style={styles.backBtn} onPress={() => setPanel('review')} disabled={sendingHistory}>
                      <Text style={styles.backBtnText}>Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.sendBtn, sendingHistory && { opacity: 0.7 }]} onPress={sendHistoryRequest} disabled={sendingHistory}>
                      {sendingHistory ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendBtnText}>Send Request + Notify Org</Text>}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            {!selLoading && sel && (
              <TouchableOpacity style={styles.closeBtn} onPress={closeReview}>
                <Text style={styles.closeBtnText}>Close</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F8FAFC' },
  headerCount:     { color: '#64748B', fontSize: 13, marginBottom: 10 },
  card:            { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  barcode:         { color: '#17B9A1', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  statusBadge:     { backgroundColor: '#F9731633', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText:      { color: '#F97316', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  patientName:     { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginTop: 8 },
  meta:            { color: '#64748B', fontSize: 12, marginTop: 4 },
  historyFlag:     { color: '#F59E0B', fontSize: 11, fontWeight: '600', marginTop: 6 },
  reviewBtn:       { backgroundColor: '#8B5CF6', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  reviewBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalTitle:      { color: '#0F172A', fontSize: 18, fontWeight: 'bold' },
  modalSub:        { color: '#64748B', fontSize: 12, marginTop: 3 },
  sectionLabel:    { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginTop: 18, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  trailRow:        { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginBottom: 6 },
  trailLabel:      { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  trailAnswer:     { color: '#64748B', fontSize: 11, marginTop: 3, fontStyle: 'italic' },
  trailBadge:      { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  trailBadgeAnswered: { backgroundColor: '#10B98133' },
  trailBadgePending:  { backgroundColor: '#F59E0B33' },
  trailBadgeText:  { fontSize: 9, fontWeight: '700', color: '#10B981' },
  trailDate:       { color: '#475569', fontSize: 10, marginTop: 4 },
  resultCard:      { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  resultCardEditing: { borderColor: '#17B9A1', borderWidth: 1.5, backgroundColor: '#17B9A108' },
  resultHeader:    { marginBottom: 8 },
  resultName:      { color: '#0F172A', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  accessionTag:    { color: '#F97316', fontSize: 12, fontWeight: '600' },
  editResultBtn:   { backgroundColor: '#17B9A115', borderWidth: 1, borderColor: '#17B9A1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, justifyContent: 'center' },
  editResultBtnText: { color: '#17B9A1', fontSize: 12, fontWeight: '700' },
  pdfBtn:          { backgroundColor: '#1E40AF', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  pdfBtnText:      { color: '#fff', fontSize: 11, fontWeight: '700' },
  paramHeaderRow:  { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 6, marginTop: 4 },
  paramHeaderText: { color: '#475569', fontSize: 9, fontWeight: '700' },
  paramRow:        { flexDirection: 'row', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  paramText:       { color: '#94A3B8', fontSize: 12 },
  checklistGrid:   { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 },
  checkRow:        { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 12, paddingRight: 8 },
  checkLabel:      { color: '#0F172A', fontSize: 13, marginLeft: 8, flexShrink: 1 },

  // ── Edit-a-result mode (Report Validate) ──
  editParamRow:      { backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', padding: 10, marginBottom: 10 },
  editParamName:     { color: '#0F172A', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  editParamInput:    { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8, fontSize: 14, fontWeight: '700', borderWidth: 1.5, borderColor: '#17B9A1' },
  flagPicker:        { flexDirection: 'row', backgroundColor: '#F8FAFC', borderRadius: 8, padding: 3, borderWidth: 1, borderColor: '#E2E8F0' },
  flagOpt:           { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 6 },
  flagOptSel:        { backgroundColor: '#EF4444' },
  flagOptText:       { color: '#64748B', fontSize: 11, fontWeight: '600' },
  flagOptTextSel:    { color: '#fff' },
  editParamRef:      { color: '#94A3B8', fontSize: 11, marginTop: 8 },
  noteLabel:         { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 0.3, marginTop: 4, marginBottom: 8, textTransform: 'uppercase' },
  noteInputSmall:    { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 64, textAlignVertical: 'top' },
  saveEditBtn:       { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveEditBtnText:   { color: '#fff', fontSize: 13, fontWeight: '700' },
  cancelEditBtn:     { paddingHorizontal: 20, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  cancelEditBtnText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  fieldLabel:      { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 6 },
  noteInput:       { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 70 },
  btnRow:          { flexDirection: 'row', gap: 10, marginTop: 18 },
  validateBtn:     { flex: 1.3, backgroundColor: '#10B981', padding: 14, borderRadius: 10, alignItems: 'center' },
  validateBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  historyBtn:      { flex: 1, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#F59E0B', padding: 14, borderRadius: 10, alignItems: 'center' },
  historyBtnText:  { color: '#F59E0B', fontWeight: '700', fontSize: 12.5 },
  backBtn:         { flex: 0.7, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', padding: 14, borderRadius: 10, alignItems: 'center' },
  backBtnText:     { color: '#94A3B8', fontWeight: '600', fontSize: 13 },
  sendBtn:         { flex: 1.6, backgroundColor: '#F59E0B', padding: 14, borderRadius: 10, alignItems: 'center' },
  sendBtnText:     { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  closeBtn:        { marginTop: 10, padding: 10, alignItems: 'center' },
  closeBtnText:    { color: '#475569', fontSize: 12 },
});
