import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Platform,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const STATUS_COLOR: Record<string, string> = {
  collected: '#3B82F6', received: '#06B6D4', tested: '#F97316',
  validated: '#A855F7', reported: '#10B981', dispatched: '#8B5CF6',
  sample_rejected: '#EF4444',
};

const STATUS_OPTIONS = ['', 'dispatched', 'received', 'tested', 'validated', 'reported'];

function toYMD(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function fmtDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function SampleReport() {
  const [rows, setRows]         = useState<any[]>([]);
  const [kpis, setKpis]         = useState<{ patients: number; billed: number; collected: number; balance: number } | null>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [barcode, setBarcode]   = useState('');
  const [status, setStatus]     = useState('');
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [franchises, setFranchises] = useState<{id:number;name:string}[]>([]);
  const [franchiseId, setFranchiseId] = useState<number | null>(null);
  const [showFranchisePicker, setShowFranchisePicker] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);

  // Detail
  const [sel, setSel]           = useState<any>(null);
  const [tab, setTab]           = useState<'tests' | 'payments' | 'history'>('tests');

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (barcode.trim())    params.set('barcode', barcode.trim());
      if (status.trim())     params.set('status', status.trim());
      if (franchiseId)       params.set('franchise_id', String(franchiseId));
      if (fromDate.trim())   params.set('date_from', fromDate.trim());
      if (toDate.trim())     params.set('date_to', toDate.trim());
      const res  = await fetch(`${API_BASE}/api/reports2/sample-details?${params.toString()}`, { headers: authHeader() });
      const json = await res.json();
      const list = json.rows ?? (Array.isArray(json) ? json : []);
      setRows(list);
      // Derive KPIs
      const billed    = list.reduce((s: number, r: any) => s + (r.billed || 0), 0);
      const collected = list.reduce((s: number, r: any) => s + (r.collected || 0), 0);
      setKpis({ patients: list.length, billed, collected, balance: billed - collected });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [barcode, status, franchiseId, fromDate, toDate]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    // Load franchises for filter dropdown
    fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setFranchises(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []); // eslint-disable-line
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };
  const applyFilters = () => { setLoading(true); fetchData(); };

  const openDetail = (row: any) => { setSel(row); setTab('tests'); };

  const renderRow = ({ item: r }: { item: any }) => {
    const color = STATUS_COLOR[r.status] ?? '#64748B';
    return (
      <TouchableOpacity style={styles.card} onPress={() => openDetail(r)}>
        <View style={styles.cardRow}>
          <Text style={styles.barcode}>📋 {r.barcode}</Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>● {r.status}</Text>
          </View>
        </View>
        <Text style={styles.name}>{r.patient_name}</Text>
        <Text style={styles.meta}>👤 {r.age}y / {r.gender}  ·  🩺 {r.referring_doctor ?? '—'}</Text>
        <Text style={styles.meta}>🏢 {r.franchise} · {r.branch}</Text>
        <View style={styles.amtRow}>
          <Text style={styles.amtItem}>Billed <Text style={styles.amtVal}>{inr(r.billed)}</Text></Text>
          <Text style={styles.amtItem}>Collected <Text style={[styles.amtVal, { color: '#10B981' }]}>{inr(r.collected)}</Text></Text>
          <Text style={styles.amtItem}>Bal <Text style={[styles.amtVal, { color: r.balance > 0 ? '#EF4444' : '#10B981' }]}>{inr(r.balance)}</Text></Text>
        </View>
        <Text style={styles.tapHint}>{r.tests?.length ?? 0} test(s) · Tap for details ›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Filters */}
      <View style={styles.filterCol}>
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 2 }]} value={barcode} onChangeText={setBarcode}
            placeholder="Barcode..." placeholderTextColor="#475569" />
          <TouchableOpacity style={[styles.filterInput, { flex: 1.4, justifyContent: 'center' }]} onPress={() => setShowStatusPicker(true)}>
            <Text style={{ color: status ? '#F1F5F9' : '#475569', fontSize: 13 }}>{status || 'Status'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterBar}>
          <TouchableOpacity style={[styles.filterInput, { flex: 1.4, justifyContent: 'center' }]} onPress={() => setShowFranchisePicker(true)}>
            <Text style={{ color: franchiseId ? '#F1F5F9' : '#475569', fontSize: 13 }} numberOfLines={1}>
              {franchises.find(f => f.id === franchiseId)?.name ?? 'All Franchises'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterInput, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowFromPicker(true)}>
            <Text style={{ color: fromDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{fromDate || 'From date'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterInput, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowToPicker(true)}>
            <Text style={{ color: toDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{toDate || 'To date'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.applyBtnFull} onPress={applyFilters}>
          <Text style={styles.applyBtnText}>Apply Filters</Text>
        </TouchableOpacity>

        {/* Clear filters */}
        {(fromDate || toDate || franchiseId || status || barcode) ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => {
            setFromDate(''); setToDate(''); setFranchiseId(null); setStatus(''); setBarcode('');
            setTimeout(applyFilters, 100);
          }}>
            <Text style={styles.clearBtnText}>Clear all filters</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Date pickers */}
      {showFromPicker && (
        <DateTimePicker
          value={fromDate ? new Date(fromDate) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => {
            setShowFromPicker(false);
            if (d) setFromDate(toYMD(d));
          }}
        />
      )}
      {showToPicker && (
        <DateTimePicker
          value={toDate ? new Date(toDate) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => {
            setShowToPicker(false);
            if (d) setToDate(toYMD(d));
          }}
        />
      )}

      {/* KPIs */}
      {kpis && (
        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#8B5CF6' }]}>{kpis.patients}</Text><Text style={styles.kpiLabel}>Patients</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#F1F5F9' }]}>{inr(kpis.billed)}</Text><Text style={styles.kpiLabel}>Billed</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#10B981' }]}>{inr(kpis.collected)}</Text><Text style={styles.kpiLabel}>Collected</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#EF4444' }]}>{inr(kpis.balance)}</Text><Text style={styles.kpiLabel}>Balance</Text></View>
        </View>
      )}

      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={rows} keyExtractor={(r, i) => (r.patient_id ?? i).toString()} renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>📄</Text><Text style={styles.emptyText}>No samples found</Text></View>}
        />
      )}

      {/* Franchise picker */}
      <Modal visible={showFranchisePicker} transparent animationType="slide" onRequestClose={() => setShowFranchisePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Filter by Franchise</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity style={[styles.pickerItem, franchiseId === null && styles.pickerItemSel]}
                onPress={() => { setFranchiseId(null); setShowFranchisePicker(false); }}>
                <Text style={styles.pickerText}>All Franchises</Text>
              </TouchableOpacity>
              {franchises.map(f => (
                <TouchableOpacity key={f.id} style={[styles.pickerItem, franchiseId === f.id && styles.pickerItemSel]}
                  onPress={() => { setFranchiseId(f.id); setShowFranchisePicker(false); }}>
                  <Text style={styles.pickerText}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowFranchisePicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Status picker */}
      <Modal visible={showStatusPicker} transparent animationType="slide" onRequestClose={() => setShowStatusPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Filter by Status</Text>
            {STATUS_OPTIONS.map(s => (
              <TouchableOpacity key={s || 'all'} style={[styles.pickerItem, status === s && styles.pickerItemSel]}
                onPress={() => { setStatus(s); setShowStatusPicker(false); }}>
                <Text style={styles.pickerText}>{s || 'All'}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowStatusPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Detail modal with tabs */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={styles.overlay}>
          <View style={styles.detailBox}>
            <View style={styles.detailHeader}>
              <View>
                <Text style={styles.detailName}>{sel?.patient_name}</Text>
                <Text style={styles.detailBarcode}>{sel?.barcode} · {sel?.status}</Text>
              </View>
              <TouchableOpacity onPress={() => setSel(null)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.tabRow}>
              {([['tests', `Tests (${sel?.tests?.length ?? 0})`], ['payments', `Payments (${sel?.payment_history?.length ?? 0})`], ['history', `History (${sel?.clinical_history?.length ?? 0})`]] as const).map(([key, label]) => (
                <TouchableOpacity key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key as any)}>
                  <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {/* Tests */}
              {tab === 'tests' && (sel?.tests ?? []).map((t: any, i: number) => (
                <View key={i} style={styles.detailItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemMain}>{t.test_name}</Text>
                    <Text style={styles.itemSub}>{t.doctor ?? 'No doctor'} · {t.bill_no ?? '—'}{t.package_name ? ` · ${t.package_name}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.itemPrice}>{inr(t.price)}</Text>
                    <Text style={styles.itemReport}>{t.result_id ? 'Report ✓' : 'No report'}</Text>
                  </View>
                </View>
              ))}

              {/* Payments */}
              {tab === 'payments' && (sel?.payment_history ?? []).length === 0 && <Text style={styles.noData}>No payments</Text>}
              {tab === 'payments' && (sel?.payment_history ?? []).map((p: any, i: number) => (
                <View key={i} style={styles.detailItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemMain}>{p.status} · {p.method}</Text>
                    <Text style={styles.itemSub}>{p.bill_no} · {fmtDate(p.at)}</Text>
                    {p.error && <Text style={styles.itemError}>{p.error}</Text>}
                  </View>
                  <Text style={[styles.itemPrice, { color: p.status === 'success' ? '#10B981' : '#EF4444' }]}>{inr(p.amount)}</Text>
                </View>
              ))}

              {/* History */}
              {tab === 'history' && (sel?.clinical_history ?? []).length === 0 && <Text style={styles.noData}>No clinical history</Text>}
              {tab === 'history' && (sel?.clinical_history ?? []).map((h: any, i: number) => (
                <View key={i} style={styles.historyItem}>
                  <View style={styles.historyRow}>
                    {(h.asked_for ?? []).map((a: string, j: number) => (
                      <View key={j} style={styles.askChip}><Text style={styles.askChipText}>{a}</Text></View>
                    ))}
                    <Text style={styles.historyDate}>{fmtDate(h.answered_at ?? h.created_at)}</Text>
                  </View>
                  {h.note && <Text style={styles.historyNote}>Q: {h.note}</Text>}
                  <Text style={styles.historyAnswer}>Answer: {h.answer ?? '—'}</Text>
                  <Text style={[styles.historyStatus, { color: h.status === 'answered' ? '#10B981' : '#F59E0B' }]}>{h.status}</Text>
                </View>
              ))}
            </ScrollView>

            <TouchableOpacity style={styles.closeBtn} onPress={() => setSel(null)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F172A' },
  filterCol:      { padding: 12, paddingBottom: 4 },
  filterBar:      { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  applyBtnFull:   { backgroundColor: '#0EA5E9', padding: 11, borderRadius: 10, alignItems: 'center' },
  clearBtn:       { padding: 8, alignItems: 'center', marginTop: 4 },
  clearBtnText:   { color: '#EF4444', fontSize: 12 },
  filterInput:    { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 10, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  applyBtn:       { backgroundColor: '#0EA5E9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  applyBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  kpiRow:         { flexDirection: 'row', paddingHorizontal: 12, gap: 6, marginBottom: 8 },
  kpiBox:         { flex: 1, backgroundColor: '#1E293B', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  kpiVal:         { fontSize: 14, fontWeight: 'bold' },
  kpiLabel:       { color: '#64748B', fontSize: 10, marginTop: 2 },
  card:           { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barcode:        { color: '#64748B', fontSize: 12 },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:      { fontSize: 11, fontWeight: '700' },
  name:           { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  meta:           { color: '#64748B', fontSize: 12, marginBottom: 2 },
  amtRow:         { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#0F172A', borderRadius: 8, padding: 8, marginTop: 8 },
  amtItem:        { color: '#64748B', fontSize: 11 },
  amtVal:         { color: '#F1F5F9', fontSize: 12, fontWeight: '700' },
  tapHint:        { color: '#475569', fontSize: 11, marginTop: 8 },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pickerBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pickerItem:     { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerItemSel:  { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  pickerText:     { color: '#F1F5F9', fontSize: 14 },
  modalCancel:    { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
  detailBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  detailHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  detailName:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  detailBarcode:  { color: '#64748B', fontSize: 12, marginTop: 2 },
  closeX:         { color: '#64748B', fontSize: 22 },
  tabRow:         { flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 10, padding: 4, marginBottom: 12 },
  tab:            { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabActive:      { backgroundColor: '#0EA5E9' },
  tabText:        { color: '#64748B', fontSize: 12, fontWeight: '600' },
  tabTextActive:  { color: '#fff' },
  detailItem:     { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  itemMain:       { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  itemSub:        { color: '#64748B', fontSize: 11, marginTop: 2 },
  itemError:      { color: '#EF4444', fontSize: 11, marginTop: 2 },
  itemPrice:      { color: '#F1F5F9', fontSize: 14, fontWeight: '700' },
  itemReport:     { color: '#475569', fontSize: 10, marginTop: 2 },
  noData:         { color: '#64748B', textAlign: 'center', paddingVertical: 24 },
  historyItem:    { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  historyRow:     { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  askChip:        { backgroundColor: '#F59E0B22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  askChipText:    { color: '#F59E0B', fontSize: 11, fontWeight: '600' },
  historyDate:    { color: '#475569', fontSize: 11, marginLeft: 'auto' },
  historyNote:    { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  historyAnswer:  { color: '#F1F5F9', fontSize: 13, marginTop: 2 },
  historyStatus:  { fontSize: 11, fontWeight: '600', marginTop: 2 },
  closeBtn:       { marginTop: 14, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  closeBtnText:   { color: '#EF4444', fontWeight: '700' },
});
