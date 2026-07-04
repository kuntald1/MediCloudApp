import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert, Switch, ScrollView,
} from 'react-native';

interface HistoryItem {
  id: number; barcode: string; patient_name: string;
  age?: number; gender?: string; status?: string;
  needs_history: boolean; created_at?: string;
  request?: { note?: string | null; checklist?: Record<string, boolean> };
}

const CHECKLIST_LABELS: Record<string, string> = {
  diabetic: 'Diabetic', hypertension: 'Hypertension', pregnant: 'Pregnant',
  on_medication: 'On medication', fasting_sample: 'Fasting sample',
};

export default function HistoryNeeded() {
  const [items, setItems]       = useState<HistoryItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [sel, setSel]           = useState<HistoryItem | null>(null);
  const [answer, setAnswer]     = useState('');
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/reports/queue/history-needed`, { headers: authHeader() });
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  const onRefresh = async () => { setRefreshing(true); await fetchItems(); setRefreshing(false); };

  const openFill = (item: HistoryItem) => {
    setSel(item);
    setAnswer(item.request?.note ?? '');
    // Pre-fill checklist from the doctor's request
    setChecklist(item.request?.checklist ?? {});
  };

  const toggleCheck = (key: string) =>
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));

  const fillHistory = async () => {
    if (!sel) return;
    if (!answer.trim() && Object.keys(checklist).length === 0) {
      Alert.alert('Error', 'Enter an answer or set the checklist'); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/reports/${sel.id}/fill-history`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: answer.trim(), answer_checklist: checklist }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        Alert.alert('✅ Done', 'History submitted — report can proceed');
        setSel(null); setAnswer(''); setChecklist({});
        fetchItems();
      } else { Alert.alert('Error', 'Could not submit history'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSubmitting(false); }
  };

  const renderItem = ({ item }: { item: HistoryItem }) => {
    const asked = item.request?.checklist ? Object.keys(item.request.checklist).filter(k => item.request!.checklist![k]) : [];
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.barcode}>📋 {item.barcode}</Text>
          {item.status && <Text style={styles.status}>{item.status}</Text>}
        </View>
        <Text style={styles.name}>{item.patient_name}</Text>
        {(item.age || item.gender) && <Text style={styles.meta}>👤 {item.age}y / {item.gender}</Text>}

        {/* What the doctor asked */}
        {item.request?.note && <Text style={styles.docNote}>📝 Doctor: {item.request.note}</Text>}
        {asked.length > 0 && (
          <View style={styles.askedRow}>
            <Text style={styles.askedLabel}>Asked about:</Text>
            {asked.map(k => (
              <View key={k} style={styles.askedChip}>
                <Text style={styles.askedChipText}>{CHECKLIST_LABELS[k] ?? k}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.fillBtn} onPress={() => openFill(item)}>
          <Text style={styles.fillBtnText}>Fill History</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // Checklist keys to show in the fill modal (from request + all standard ones)
  const modalKeys = sel
    ? Array.from(new Set([...Object.keys(sel.request?.checklist ?? {}), ...Object.keys(CHECKLIST_LABELS)]))
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.count}>{items.length} patient{items.length !== 1 ? 's' : ''} need history</Text>
      </View>
      {loading ? <ActivityIndicator color="#F59E0B" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={items} keyExtractor={(i, idx) => (i.id ?? idx).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>✅</Text><Text style={styles.emptyText}>No pending history requests</Text></View>}
        />
      )}

      {/* Fill history modal */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>📜 Fill History</Text>
            <Text style={styles.modalName}>{sel?.patient_name}</Text>
            <Text style={styles.modalBarcode}>{sel?.barcode}</Text>

            {sel?.request?.note && (
              <View style={styles.docRequestBox}>
                <Text style={styles.docRequestText}>Doctor asked: {sel.request.note}</Text>
              </View>
            )}

            <ScrollView style={{ maxHeight: 380 }}>
              {/* Checklist */}
              <Text style={styles.sectionLabel}>Clinical checklist</Text>
              <View style={styles.checklistCard}>
                {modalKeys.map(key => (
                  <View key={key} style={styles.checkRow}>
                    <Text style={styles.checkLabel}>{CHECKLIST_LABELS[key] ?? key}</Text>
                    <Switch value={!!checklist[key]} onValueChange={() => toggleCheck(key)}
                      trackColor={{ false: '#334155', true: '#F59E0B' }} thumbColor="#fff" />
                  </View>
                ))}
              </View>

              {/* Answer */}
              <Text style={[styles.sectionLabel, { marginTop: 14 }]}>Notes / Answer</Text>
              <TextInput style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
                value={answer} onChangeText={setAnswer} multiline
                placeholder="e.g. Patient fasted 12 hours, on Amlodipine for BP..." placeholderTextColor="#475569" />
            </ScrollView>

            <View style={styles.btnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setSel(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} onPress={fillHistory} disabled={submitting}>
                <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit History'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F172A' },
  header:         { padding: 12 },
  count:          { color: '#F59E0B', fontSize: 13, fontWeight: '600' },
  card:           { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#F59E0B44' },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  barcode:        { color: '#64748B', fontSize: 12 },
  status:         { color: '#F97316', fontSize: 11, fontWeight: '600' },
  name:           { color: '#F1F5F9', fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  meta:           { color: '#64748B', fontSize: 12, marginBottom: 6 },
  docNote:        { color: '#F59E0B', fontSize: 13, marginBottom: 6 },
  askedRow:       { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 },
  askedLabel:     { color: '#64748B', fontSize: 11 },
  askedChip:      { backgroundColor: '#F59E0B22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#F59E0B44' },
  askedChipText:  { color: '#F59E0B', fontSize: 11, fontWeight: '600' },
  fillBtn:        { backgroundColor: '#F59E0B', padding: 10, borderRadius: 8, alignSelf: 'flex-start' },
  fillBtnText:    { color: '#000', fontWeight: 'bold', fontSize: 13 },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  modalName:      { color: '#F1F5F9', fontSize: 15, fontWeight: '600' },
  modalBarcode:   { color: '#64748B', fontSize: 12, marginBottom: 10 },
  docRequestBox:  { backgroundColor: '#F59E0B22', borderRadius: 8, padding: 10, marginBottom: 12 },
  docRequestText: { color: '#F59E0B', fontSize: 13 },
  sectionLabel:   { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  checklistCard:  { backgroundColor: '#0F172A', borderRadius: 12, padding: 12 },
  checkRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  checkLabel:     { color: '#F1F5F9', fontSize: 14 },
  input:          { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  btnRow:         { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn:      { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:     { color: '#94A3B8', fontWeight: '600' },
  submitBtn:      { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F59E0B', alignItems: 'center' },
  submitText:     { color: '#000', fontWeight: '700' },
});
