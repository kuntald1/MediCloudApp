import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Platform,
} from 'react-native';

// Tests (or whole test groups) an admin took off a bill — who, when, why and how
// much came off. Same filters as Sample Report; the dates are the day the test
// was deleted and Stage is how far the test had got by then.

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const when = (d?: string) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const STAGES = ['', 'collected', 'received', 'tested', 'validated', 'reported', 'sample_rejected'];
const STAGE_COLOR: Record<string, string> = {
  collected: '#64748B', received: '#06B6D4', tested: '#F97316',
  validated: '#A855F7', reported: '#10B981', sample_rejected: '#EF4444',
};
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function DeletedTests() {
  const [rows, setRows]       = useState<any[]>([]);
  const [totals, setTotals]   = useState<{ deletions: number; cancelled_bills?: number; bills: number; amount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [patientName, setPatientName] = useState('');
  const [barcode, setBarcode]         = useState('');
  const [stage, setStage]             = useState('');
  const [franchises, setFranchises]   = useState<{ id: number; name: string }[]>([]);
  const [franchiseId, setFranchiseId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [picker, setPicker]     = useState<'stage' | 'franchise' | 'from' | 'to' | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (patientName.trim()) p.set('patient_name', patientName.trim());
      if (barcode.trim())     p.set('barcode', barcode.trim());
      if (stage)              p.set('status', stage);
      if (franchiseId)        p.set('franchise_id', String(franchiseId));
      if (fromDate)           p.set('date_from', fromDate);
      if (toDate)             p.set('date_to', toDate);
      const res  = await fetch(`${API_BASE}/api/reports2/deleted-tests?${p.toString()}`, { headers: authHeader() });
      const json = res.ok ? await res.json() : { rows: [], totals: null };
      setRows(json.rows ?? []);
      setTotals(json.totals ?? null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [patientName, barcode, stage, franchiseId, fromDate, toDate]);

  useEffect(() => {
    fetchData();
    fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : []).then(d => setFranchises(Array.isArray(d) ? d : [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => { setLoading(true); fetchData(); };
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };
  const anyFilter = !!(patientName || barcode || stage || franchiseId || fromDate || toDate);
  const clearAll = () => {
    setPatientName(''); setBarcode(''); setStage(''); setFranchiseId(null); setFromDate(''); setToDate('');
    setTimeout(apply, 100);
  };

  const renderRow = ({ item: r }: { item: any }) => {
    const c = STAGE_COLOR[r.status] ?? '#64748B';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.billNo}>{r.bill_no}</Text>
          <Text style={styles.amount}>– {inr(r.amount)}</Text>
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.testName}>{r.name}</Text>
          {r.is_group ? <Text style={styles.grpPill}>GROUP</Text> : null}
          {r.kind === 'bill_cancelled' ? <Text style={styles.cancelPill}>BILL CANCELLED</Text> : null}
          {r.status ? <Text style={[styles.stagePill, { color: c, backgroundColor: c + '1A' }]}>{String(r.status).replace('_', ' ')}</Text> : null}
        </View>
        {(r.is_group || r.kind === 'bill_cancelled') ? <Text style={styles.members}>{(r.members ?? []).join(', ')}</Text> : null}
        <Text style={styles.meta}>👤 {r.patient_name ?? '—'}  ·  <Text style={styles.code}>{r.barcode ?? '—'}</Text>{r.accession_number ? <Text style={styles.code}>  ·  {r.accession_number}</Text> : null}</Text>
        <Text style={styles.meta}>🏢 {r.franchise} · {r.branch}</Text>
        <View style={styles.byBox}>
          <Text style={styles.byText}>🗑 {when(r.deleted_at)}{r.deleted_by ? `  ·  by ${r.deleted_by}` : ''}</Text>
          {r.reason ? <Text style={styles.reason}>“{r.reason}”</Text> : null}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.filterCol}>
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 1 }]} value={patientName} onChangeText={setPatientName}
            placeholder="Patient name..." placeholderTextColor="#475569" />
        </View>
        <View style={styles.filterBar}>
          <TextInput style={[styles.filterInput, { flex: 2 }]} value={barcode} onChangeText={setBarcode}
            placeholder="Barcode / accession..." placeholderTextColor="#475569" autoCapitalize="characters" />
          <TouchableOpacity style={[styles.filterInput, { flex: 1.4, justifyContent: 'center' }]} onPress={() => setPicker('stage')}>
            <Text style={{ color: stage ? '#0F172A' : '#475569', fontSize: 13 }}>{stage ? stage.replace('_', ' ') : 'Stage'}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterBar}>
          <TouchableOpacity style={[styles.filterInput, { flex: 1.4, justifyContent: 'center' }]} onPress={() => setPicker('franchise')}>
            <Text style={{ color: franchiseId ? '#0F172A' : '#475569', fontSize: 13 }} numberOfLines={1}>
              {franchises.find(f => f.id === franchiseId)?.name ?? 'All Franchises'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterInput, { flex: 1, justifyContent: 'center' }]} onPress={() => setPicker('from')}>
            <Text style={{ color: fromDate ? '#0F172A' : '#475569', fontSize: 12 }}>{fromDate || 'Deleted from'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterInput, { flex: 1, justifyContent: 'center' }]} onPress={() => setPicker('to')}>
            <Text style={{ color: toDate ? '#0F172A' : '#475569', fontSize: 12 }}>{toDate || 'Deleted to'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={apply}>
          <Text style={styles.applyBtnText}>Apply Filters</Text>
        </TouchableOpacity>
        {anyFilter && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
            <Text style={styles.clearBtnText}>Clear all filters</Text>
          </TouchableOpacity>
        )}
      </View>

      {(picker === 'from' || picker === 'to') && (
        <DateTimePicker
          value={(picker === 'from' ? fromDate : toDate) ? new Date(picker === 'from' ? fromDate : toDate) : new Date()}
          mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => { const which = picker; setPicker(null); if (d) (which === 'from' ? setFromDate : setToDate)(toYMD(d)); }}
        />
      )}

      {totals && (
        <View style={styles.kpiRow}>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#EF4444' }]}>{totals.deletions}</Text><Text style={styles.kpiLabel}>Tests deleted</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#64748B' }]}>{totals.cancelled_bills ?? 0}</Text><Text style={styles.kpiLabel}>Bills cancelled</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#6366F1' }]}>{totals.bills}</Text><Text style={styles.kpiLabel}>Bills</Text></View>
          <View style={styles.kpiBox}><Text style={[styles.kpiVal, { color: '#0F172A' }]}>{inr(totals.amount)}</Text><Text style={styles.kpiLabel}>Amount removed</Text></View>
        </View>
      )}

      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={rows} keyExtractor={(r, i) => String(r.id ?? i)} renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🗑</Text><Text style={styles.emptyText}>No deleted tests</Text></View>}
        />
      )}

      <Modal visible={picker === 'stage' || picker === 'franchise'} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>{picker === 'stage' ? 'Stage when deleted' : 'Filter by Franchise'}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {picker === 'stage' && STAGES.map(s => (
                <TouchableOpacity key={s || 'all'} style={[styles.pickerItem, stage === s && styles.pickerItemSel]}
                  onPress={() => { setStage(s); setPicker(null); }}>
                  <Text style={styles.pickerText}>{s ? s.replace('_', ' ') : 'All'}</Text>
                </TouchableOpacity>
              ))}
              {picker === 'franchise' && (
                <>
                  <TouchableOpacity style={[styles.pickerItem, franchiseId === null && styles.pickerItemSel]}
                    onPress={() => { setFranchiseId(null); setPicker(null); }}>
                    <Text style={styles.pickerText}>All Franchises</Text>
                  </TouchableOpacity>
                  {franchises.map(f => (
                    <TouchableOpacity key={f.id} style={[styles.pickerItem, franchiseId === f.id && styles.pickerItemSel]}
                      onPress={() => { setFranchiseId(f.id); setPicker(null); }}>
                      <Text style={styles.pickerText}>{f.name}</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setPicker(null)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F8FAFC' },
  filterCol:     { padding: 12, paddingBottom: 4 },
  filterBar:     { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 6 },
  filterInput:   { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 10, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0' },
  applyBtn:      { backgroundColor: '#17B9A1', padding: 11, borderRadius: 10, alignItems: 'center' },
  applyBtnText:  { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn:      { padding: 8, alignItems: 'center', marginTop: 4 },
  clearBtnText:  { color: '#EF4444', fontSize: 12 },
  kpiRow:        { flexDirection: 'row', paddingHorizontal: 12, gap: 6, marginBottom: 8, marginTop: 4 },
  kpiBox:        { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  kpiVal:        { fontSize: 14, fontWeight: 'bold' },
  kpiLabel:      { color: '#64748B', fontSize: 10, marginTop: 2 },
  card:          { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', borderLeftWidth: 3, borderLeftColor: '#EF4444' },
  cardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  billNo:        { color: '#0F172A', fontSize: 13, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  amount:        { color: '#DC2626', fontSize: 14, fontWeight: '800' },
  nameRow:       { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 },
  testName:      { color: '#475569', fontSize: 15, fontWeight: '700', textDecorationLine: 'line-through' },
  grpPill:       { color: '#C2410C', backgroundColor: '#F973161F', fontSize: 9.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, overflow: 'hidden' },
  stagePill:     { fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', textTransform: 'capitalize' },
  cancelPill:    { color: '#475569', backgroundColor: '#64748B24', fontSize: 9.5, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10, overflow: 'hidden' },
  members:       { color: '#94A3B8', fontSize: 11.5, marginBottom: 4 },
  meta:          { color: '#64748B', fontSize: 12, marginTop: 3 },
  code:          { color: '#6366F1', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11.5 },
  byBox:         { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 8, marginTop: 8 },
  byText:        { color: '#475569', fontSize: 11.5, fontWeight: '600' },
  reason:        { color: '#64748B', fontSize: 11.5, fontStyle: 'italic', marginTop: 2 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 44 },
  emptyText:     { color: '#475569', fontSize: 15, marginTop: 10 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pickerBox:     { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:    { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pickerItem:    { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  pickerItemSel: { borderColor: '#17B9A1', backgroundColor: '#17B9A115' },
  pickerText:    { color: '#0F172A', fontSize: 14, textTransform: 'capitalize' },
  modalCancel:   { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
