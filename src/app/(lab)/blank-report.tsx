/**
 * Blank Report — a report for a test no analyser ever sends.
 *
 * Search the billed tests the same way the Bills screen does, tick the ones
 * that need a report, and the server creates each with every parameter the
 * test declares and no values. They then open here to be typed in and saved,
 * so a hand-read test reaches the same report as a machine-read one. A test
 * going to an outside lab can be marked Outsourced from the same list instead.
 */
import { API_BASE, authHeader, getUser } from '../../../src/utils/auth';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import TestFilter, { splitTestFilter, useTestOptions } from '../../components/TestFilter';
import ResultEditor from '../../components/ResultEditor';

const CAN_CREATE = ['super_admin', 'lab_admin', 'pathologist', 'technician'];
const STAGES = ['', 'collected', 'received', 'tested', 'validated', 'reported', 'outsource', 'sample_rejected'];
const errText = (d: any) => Array.isArray(d) ? d.map((x: any) => x?.msg ?? String(x)).join('; ') : (d ?? '');

type Line = {
  id: number; test_name: string; package_name?: string | null;
  accession_number?: string | null; status?: string | null;
  bill_no: string; patient_name: string; barcode: string;
  test_id?: number | null; package_id?: number | null;
};

export default function BlankReport() {
  const allowed = CAN_CREATE.includes(String(getUser()?.role ?? '').toLowerCase());

  const [barcode, setBarcode]         = useState('');
  const [patientName, setPatientName] = useState('');
  const [fromDate, setFromDate]       = useState('');
  const [toDate, setToDate]           = useState('');
  const [stage, setStage]             = useState('received');   // tests still waiting for a result
  const [testPick, setTestPick]       = useState('');
  const testOptions                   = useTestOptions();

  const [lines, setLines]       = useState<Line[]>([]);
  const [loading, setLoading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searched, setSearched] = useState(false);
  const [picked, setPicked]     = useState<number[]>([]);
  const [made, setMade]         = useState<any[]>([]);
  const [busy, setBusy]         = useState(false);
  const [stagePicker, setStagePicker] = useState(false);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (barcode.trim())     qs.set('barcode', barcode.trim());
      if (patientName.trim()) qs.set('patient_name', patientName.trim());
      if (fromDate.trim())    qs.set('date_from', fromDate.trim());
      if (toDate.trim())      qs.set('date_to', toDate.trim());
      if (stage)              qs.set('stage', stage);
      Object.entries(splitTestFilter(testPick)).forEach(([k, v]) => qs.set(k, v));
      const res  = await fetch(`${API_BASE}/api/billing/bills${qs.toString() ? `?${qs.toString()}` : ''}`,
        { headers: authHeader() });
      const data = await res.json();
      const bills = Array.isArray(data) ? data : (data.items ?? []);
      // the API matches whole bills; keep only the lines at the chosen status / test / group
      const tp = testPick;
      setLines(bills.flatMap((b: any) => (b.items ?? []).map((it: any) => ({
        ...it, bill_no: b.bill_no, patient_name: b.patient_name, barcode: b.barcode,
      }))).filter((it: any) => !stage || it.status === stage)
        .filter((it: any) => !tp || (tp.startsWith('p:') ? String(it.package_id) === tp.slice(2)
                                                          : String(it.test_id) === tp.slice(2))));
      setPicked([]);
      setSearched(true);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }, [barcode, patientName, fromDate, toDate, stage, testPick]);

  // open on the tests still waiting for a result, without needing a tap
  useEffect(() => { if (allowed) search(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => { setRefreshing(true); await search(); setRefreshing(false); };

  const toggle = (id: number) =>
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const createBlank = async () => {
    if (picked.length === 0) { Alert.alert('Pick a test', 'Tick at least one test first.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/results/blank`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bill_item_ids: picked }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(data.detail) || 'Could not create the report');
      setMade(data.results ?? []);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  };

  // A report with real values is a tested one: move its billed test to "tested" so it
  // reaches the doctor's Report Validate queue. Tests already further along stay put.
  const markTested = async (r: any, data: any) => {
    const filled = (data?.parsed_data?.parameters ?? []).some((p: any) => String(p.value ?? '').trim() !== '');
    const line = lines.find(l => l.id === r.bill_item_id);
    if (!filled || !r.bill_item_id || (line && !['collected', 'received'].includes(String(line.status)))) return;
    try {
      const res = await fetch(`${API_BASE}/api/sample-status/advance`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: [r.bill_item_id], status: 'tested' }),
      });
      if (res.ok) search();
    } catch { /* values are saved either way; Change Status can move it by hand */ }
  };

  const sendToOutsource = async () => {
    if (picked.length === 0) { Alert.alert('Pick a test', 'Tick at least one test first.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/sample-status/advance`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: picked, status: 'outsource' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(data.detail) || 'Could not change the status');
      Alert.alert('📤 Outsourced',
        `${data.updated ?? picked.length} test(s) marked Outsourced. Upload the outside lab's report from Results.`);
      search();
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setBusy(false); }
  };

  if (!allowed) {
    return (
      <View style={styles.center}>
        <Text style={styles.denied}>
          Blank reports can only be created by a lab admin, technician or pathologist login.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}>

        {/* filters — the same set as the Bills screen */}
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 1 }]} value={patientName} onChangeText={setPatientName}
            placeholder="Patient name…" placeholderTextColor="#94A3B8" />
        </View>
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 2 }]} value={barcode} onChangeText={setBarcode}
            placeholder="Barcode…" placeholderTextColor="#94A3B8" autoCapitalize="characters" />
          <TouchableOpacity style={[styles.filterInput, { flex: 1.4, justifyContent: 'center' }]}
            onPress={() => setStagePicker(true)}>
            <Text style={{ color: stage ? '#0F172A' : '#94A3B8', fontSize: 13 }} numberOfLines={1}>
              {stage || 'Status'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 1 }]} value={fromDate} onChangeText={setFromDate}
            placeholder="From  YYYY-MM-DD" placeholderTextColor="#94A3B8" />
          <TextInput style={[styles.filterInput, { flex: 1 }]} value={toDate} onChangeText={setToDate}
            placeholder="To  YYYY-MM-DD" placeholderTextColor="#94A3B8" />
        </View>
        <View style={styles.filterBar}>
          <View style={{ flex: 1 }}>
            <TestFilter value={testPick} onChange={setTestPick} options={testOptions} />
          </View>
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={search}>
          <Text style={styles.applyBtnText}>Apply Filters</Text>
        </TouchableOpacity>
        {(barcode || patientName || fromDate || toDate || stage || testPick) ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => {
            setBarcode(''); setPatientName(''); setFromDate(''); setToDate(''); setStage(''); setTestPick('');
          }}>
            <Text style={styles.clearBtnText}>Clear all filters</Text>
          </TouchableOpacity>
        ) : null}

        {/* the billed tests that came back */}
        <View style={styles.listHead}>
          <Text style={styles.count}>
            {loading ? 'Searching…' : `${lines.length} billed test(s)`}{picked.length > 0 ? ` · ${picked.length} selected` : ''}
          </Text>
        </View>

        {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 28 }} /> : (
          lines.length === 0 ? (
            <Text style={styles.empty}>
              {searched ? 'No billed test matches those filters.' : 'Set the filters above and tap Apply Filters.'}
            </Text>
          ) : lines.map(it => {
            const on = picked.includes(it.id);
            return (
              <TouchableOpacity key={it.id} style={[styles.lineCard, on && styles.lineCardOn]} onPress={() => toggle(it.id)}>
                <View style={[styles.tick, on && styles.tickOn]}>
                  <Text style={styles.tickMark}>{on ? '✓' : ''}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineTest} numberOfLines={2}>{it.test_name}</Text>
                  {!!it.package_name && <Text style={styles.linePack} numberOfLines={1}>{it.package_name}</Text>}
                  <Text style={styles.lineMeta} numberOfLines={1}>
                    {it.patient_name || '—'} · {it.barcode || '—'} · {it.accession_number || '—'}
                  </Text>
                  <Text style={styles.lineMeta} numberOfLines={1}>{it.bill_no} · {it.status || '—'}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {lines.length > 0 && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <TouchableOpacity style={[styles.createBtn, picked.length === 0 && { opacity: 0.5 }]}
              disabled={busy || picked.length === 0} onPress={createBlank}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>＋ Create Blank Report</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.outBtn, picked.length === 0 && { opacity: 0.5 }]}
              disabled={busy || picked.length === 0} onPress={sendToOutsource}>
              <Text style={styles.outBtnText}>📤 Outsource</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* the reports just created, each editable and saved on its own */}
        {made.length > 0 && (
          <View style={{ marginTop: 20 }}>
            <Text style={styles.madeTitle}>Fill in the values</Text>
            <Text style={styles.madeSub}>
              {made.length} report(s) ready — each saves on its own. A parameter left blank stays off the printed report.
            </Text>
            {made.map(r => (
              <View key={r.id} style={styles.madeCard}>
                <View style={styles.madeHead}>
                  <Text style={styles.madeName} numberOfLines={1}>
                    {r.patient_name || '—'}  <Text style={styles.madeCode}>{r.barcode || '—'}</Text>
                  </Text>
                  <Text style={styles.madeMeta} numberOfLines={1}>{r.test_name} · {r.accession_number || '—'}</Text>
                </View>
                <View style={styles.madeBody}>
                  <ResultEditor result={r} onSaved={data => {
                    setMade(prev => prev.map(x => x.id === r.id
                      ? { ...x, parsed_data: data.parsed_data ?? x.parsed_data, note: data.note ?? x.note } : x));
                    markTested(r, data);
                  }} />
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={stagePicker} transparent animationType="slide" onRequestClose={() => setStagePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.pickerTitle}>Status</Text>
            {STAGES.map(st => (
              <TouchableOpacity key={st || 'all'} style={styles.pickerItem}
                onPress={() => { setStage(st); setStagePicker(false); }}>
                <Text style={styles.pickerText}>{st ? st.replace('_', ' ') : 'All'}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.pickerCancel} onPress={() => setStagePicker(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F8FAFC' },
  center:        { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', padding: 28 },
  denied:        { color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  filterBar:     { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  filterInput:   { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 11, borderRadius: 10,
                   fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0' },
  applyBtn:      { backgroundColor: '#17B9A1', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  applyBtnText:  { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  clearBtn:      { padding: 8, alignItems: 'center', marginTop: 4 },
  clearBtnText:  { color: '#EF4444', fontSize: 12 },
  listHead:      { marginTop: 14, marginBottom: 8 },
  count:         { color: '#64748B', fontSize: 12.5, fontWeight: '700' },
  empty:         { color: '#94A3B8', fontSize: 13, textAlign: 'center', paddingVertical: 28, lineHeight: 20 },
  lineCard:      { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FFFFFF',
                   borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, marginBottom: 8 },
  lineCardOn:    { borderColor: '#F97316', backgroundColor: '#FFF7ED' },
  tick:          { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#CBD5E1',
                   alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  tickOn:        { backgroundColor: '#F97316', borderColor: '#F97316' },
  tickMark:      { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  lineTest:      { color: '#0F172A', fontSize: 13.5, fontWeight: '700' },
  linePack:      { color: '#7C3AED', fontSize: 11, marginTop: 2 },
  lineMeta:      { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  createBtn:     { flex: 1.4, backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  createBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  outBtn:        { flex: 1, backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(124,58,237,0.5)',
                   borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  outBtnText:    { color: '#7C3AED', fontWeight: 'bold', fontSize: 13 },
  madeTitle:     { color: '#0F172A', fontSize: 15, fontWeight: 'bold' },
  madeSub:       { color: '#94A3B8', fontSize: 11.5, marginTop: 3, marginBottom: 10, lineHeight: 17 },
  madeCard:      { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 10 },
  madeHead:      { padding: 11, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  madeName:      { color: '#0F172A', fontSize: 13.5, fontWeight: '700' },
  madeCode:      { color: '#C2410C', fontWeight: '700' },
  madeMeta:      { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  madeBody:      { padding: 11, backgroundColor: '#fff' },
  overlay:       { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  pickerBox:     { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 26 },
  pickerTitle:   { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
  pickerItem:    { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  pickerText:    { color: '#0F172A', fontSize: 13.5, textTransform: 'capitalize' },
  pickerCancel:  { marginTop: 12, padding: 13, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center' },
  pickerCancelText: { color: '#475569', fontWeight: 'bold', fontSize: 13.5 },
});
