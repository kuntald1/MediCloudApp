import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, Modal, Platform,
} from 'react-native';

const pad  = (n: number) => n.toString().padStart(2, '0');
const fmt  = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const todayStr    = toYMD(today);
const monthStart  = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toYMD(d); };

const STATUS_COLOR: Record<string, string> = { paid: '#10B981', unpaid: '#EF4444', credit: '#8B5CF6', partial: '#F59E0B' };

type QuickRange = 'today' | '7d' | 'month' | null;
interface Franchise { id: number; name: string; }

export default function Dashboard() {
  const [data, setData]             = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [fromDate, setFromDate]     = useState(monthStart);
  const [toDate, setToDate]         = useState(todayStr);
  const [quickRange, setQuickRange] = useState<QuickRange>('month');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);

  // Franchise filter
  const [franchises, setFranchises]         = useState<Franchise[]>([]);
  const [franchiseId, setFranchiseId]       = useState<number | null>(null);
  const [showFranchisePicker, setShowFranchisePicker] = useState(false);

  const fetchFranchises = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() });
      const data = await res.json();
      setFranchises(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const fetchDashboard = useCallback(async (from: string, to: string, fid: number | null) => {
    try {
      const params = new URLSearchParams();
      params.set('date_from', from);
      params.set('date_to', to);
      if (fid != null) params.set('franchise_id', String(fid));
      const res  = await fetch(`${API_BASE}/api/reports2/dashboard?${params.toString()}`, { headers: authHeader() });
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchFranchises(); }, [fetchFranchises]);
  useEffect(() => { setLoading(true); fetchDashboard(fromDate, toDate, franchiseId); }, []); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchDashboard(fromDate, toDate, franchiseId); };
  const applyFilters = () => { setQuickRange(null); setLoading(true); fetchDashboard(fromDate, toDate, franchiseId); };

  const applyQuickRange = (r: Exclude<QuickRange, null>) => {
    const from = r === 'today' ? todayStr : r === '7d' ? daysAgo(6) : monthStart;
    setFromDate(from); setToDate(todayStr); setQuickRange(r);
    setLoading(true); fetchDashboard(from, todayStr, franchiseId);
  };

  const selectFranchise = (fid: number | null) => {
    setFranchiseId(fid);
    setShowFranchisePicker(false);
    setLoading(true);
    fetchDashboard(fromDate, toDate, fid);
  };

  const franchiseName = franchiseId == null ? 'All Franchises' : (franchises.find(f => f.id === franchiseId)?.name ?? 'Selected');

  const kpis = data?.kpis;
  const daily      = data?.daily ?? [];
  const methods    = data?.methods ?? [];
  const breakdown  = data?.breakdown ?? [];
  const recent     = data?.recent ?? [];

  // Bar chart height scale
  const maxBilled  = Math.max(...daily.map((d: any) => d.billed), 1);

  return (
    <ScrollView style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}>

      {/* Franchise filter */}
      <View style={styles.filterBar}>
        <Text style={styles.filterLabel}>Franchise</Text>
        <TouchableOpacity style={styles.franchiseBtn} onPress={() => setShowFranchisePicker(true)}>
          <Text style={styles.franchiseBtnText} numberOfLines={1}>{franchiseName}</Text>
          <Text style={styles.franchiseArrow}>▾</Text>
        </TouchableOpacity>
      </View>

      {/* From / To date range */}
      <View style={styles.dateRow}>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.filterLabel}>From</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowFromPicker(true)}>
            <Text style={styles.dateBtnText}>{fromDate}</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text style={styles.filterLabel}>To</Text>
          <TouchableOpacity style={styles.dateBtn} onPress={() => setShowToPicker(true)}>
            <Text style={styles.dateBtnText}>{toDate}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
          <Text style={styles.applyBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>

      {/* Quick range toggle */}
      <View style={styles.rangeRow}>
        {(['today', '7d', 'month'] as Exclude<QuickRange, null>[]).map(r => (
          <TouchableOpacity key={r} style={[styles.rangeBtn, quickRange === r && styles.rangeBtnActive]}
            onPress={() => applyQuickRange(r)}>
            <Text style={[styles.rangeBtnText, quickRange === r && { color: '#fff' }]}>
              {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : 'This Month'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : !kpis ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No data</Text></View>
      ) : (
        <>
          {/* ── KPI Cards ── */}
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderTopColor: '#0EA5E9' }]}>
              <Text style={styles.kpiLabel}>Billed</Text>
              <Text style={[styles.kpiVal, { color: '#0EA5E9' }]}>{fmt(kpis.billed)}</Text>
              <Text style={styles.kpiSub}>{kpis.bills} bills</Text>
            </View>
            <View style={[styles.kpiCard, { borderTopColor: '#10B981' }]}>
              <Text style={styles.kpiLabel}>Collected</Text>
              <Text style={[styles.kpiVal, { color: '#10B981' }]}>{fmt(kpis.collected)}</Text>
              <Text style={styles.kpiSub}>Avg {fmt(kpis.avg_bill)}</Text>
            </View>
          </View>
          <View style={styles.kpiRow}>
            <View style={[styles.kpiCard, { borderTopColor: '#EF4444' }]}>
              <Text style={styles.kpiLabel}>Balance</Text>
              <Text style={[styles.kpiVal, { color: '#EF4444' }]}>{fmt(kpis.balance)}</Text>
              <Text style={styles.kpiSub}>Discount {fmt(kpis.discount)}</Text>
            </View>
            <View style={[styles.kpiCard, { borderTopColor: '#8B5CF6' }]}>
              <Text style={styles.kpiLabel}>Credit</Text>
              <Text style={[styles.kpiVal, { color: '#8B5CF6' }]}>{fmt(kpis.credit)}</Text>
              <Text style={styles.kpiSub}>On credit</Text>
            </View>
          </View>

          {/* ── Daily Revenue Bar Chart ── */}
          {daily.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Daily Revenue ({daily.length} days)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.barChart}>
                  {daily.map((d: any, i: number) => {
                    const h = Math.max((d.billed / maxBilled) * 100, 4);
                    return (
                      <View key={i} style={styles.barWrap}>
                        <Text style={styles.barAmt}>{fmt(d.billed)}</Text>
                        <View style={[styles.bar, { height: h }]} />
                        <Text style={styles.barDate}>{d.date.slice(5)}</Text>
                        <Text style={styles.barBills}>{d.bills}b</Text>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
            </View>
          )}

          {/* ── Payment Methods ── */}
          {methods.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Payment Methods</Text>
              {methods.map((m: any, i: number) => {
                const total = methods.reduce((s: number, x: any) => s + x.amount, 0);
                const pct   = total > 0 ? Math.round((m.amount / total) * 100) : 0;
                return (
                  <View key={i} style={styles.methodRow}>
                    <Text style={styles.methodName}>{m.method}</Text>
                    <View style={styles.methodBarBg}>
                      <View style={[styles.methodBarFill, { width: `${pct}%`, backgroundColor: i === 0 ? '#0EA5E9' : '#10B981' }]} />
                    </View>
                    <Text style={styles.methodAmt}>{fmt(m.amount)} ({pct}%)</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── Franchise Breakdown ── */}
          {breakdown.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Franchise Breakdown</Text>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, { flex: 2 }]}>Company</Text>
                <Text style={styles.th}>Bills</Text>
                <Text style={styles.th}>Billed</Text>
                <Text style={styles.th}>Share</Text>
              </View>
              {breakdown.map((b: any, i: number) => (
                <View key={i} style={[styles.tableRow, i % 2 === 0 && { backgroundColor: '#0F172A' }]}>
                  <Text style={[styles.td, { flex: 2, color: '#F1F5F9' }]} numberOfLines={1}>{b.company}</Text>
                  <Text style={styles.td}>{b.bills}</Text>
                  <Text style={[styles.td, { color: '#10B981' }]}>{fmt(b.billed)}</Text>
                  <Text style={[styles.td, { color: '#0EA5E9' }]}>{b.share}%</Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Recent Bills ── */}
          {recent.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Bills</Text>
              {recent.slice(0, 10).map((b: any, i: number) => {
                const color = STATUS_COLOR[b.status] ?? '#64748B';
                return (
                  <View key={i} style={styles.billRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billNo}>{b.bill_no}</Text>
                      <Text style={styles.billPatient} numberOfLines={1}>{b.patient_name}</Text>
                      <Text style={styles.billCompany}>{b.company}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.billTotal, { color }]}>{fmt(b.total)}</Text>
                      <View style={[styles.billBadge, { borderColor: color }]}>
                        <Text style={[styles.billBadgeText, { color }]}>{b.status}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
      <View style={{ height: 32 }} />

      {/* Franchise picker modal */}
      <Modal visible={showFranchisePicker} transparent animationType="slide" onRequestClose={() => setShowFranchisePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Franchise</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              <TouchableOpacity style={[styles.patItem, franchiseId == null && styles.patItemSel]}
                onPress={() => selectFranchise(null)}>
                <Text style={styles.patName}>All Franchises</Text>
              </TouchableOpacity>
              {franchises.map(f => (
                <TouchableOpacity key={f.id} style={[styles.patItem, franchiseId === f.id && styles.patItemSel]}
                  onPress={() => selectFranchise(f.id)}>
                  <Text style={styles.patName}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowFranchisePicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {showFromPicker && (
        <DateTimePicker value={fromDate ? new Date(fromDate) : new Date()} mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => { setShowFromPicker(false); if (d) { setFromDate(toYMD(d)); setQuickRange(null); } }} />
      )}
      {showToPicker && (
        <DateTimePicker value={toDate ? new Date(toDate) : new Date()} mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(e, d) => { setShowToPicker(false); if (d) { setToDate(toYMD(d)); setQuickRange(null); } }} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  filterBar:       { paddingHorizontal: 12, paddingTop: 12 },
  filterLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  franchiseBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1E293B', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  franchiseBtnText:{ color: '#F1F5F9', fontSize: 13, flex: 1 },
  franchiseArrow:  { color: '#64748B', marginLeft: 8 },
  dateRow:         { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 10 },
  dateBtn:         { backgroundColor: '#1E293B', padding: 11, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  dateBtnText:     { color: '#F1F5F9', fontSize: 12 },
  applyBtn:        { backgroundColor: '#0EA5E9', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10 },
  applyBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  rangeRow:        { flexDirection: 'row', padding: 12, gap: 8 },
  rangeBtn:        { flex: 1, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1E293B', alignItems: 'center' },
  rangeBtnActive:  { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  rangeBtnText:    { color: '#64748B', fontWeight: '600', fontSize: 12 },
  kpiRow:          { flexDirection: 'row', paddingHorizontal: 12, gap: 10, marginBottom: 10 },
  kpiCard:         { flex: 1, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderTopWidth: 3 },
  kpiLabel:        { color: '#64748B', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  kpiVal:          { fontSize: 20, fontWeight: 'bold', marginBottom: 2 },
  kpiSub:          { color: '#475569', fontSize: 11 },
  section:         { marginHorizontal: 12, marginBottom: 12, backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  sectionTitle:    { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  barChart:        { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 10, paddingBottom: 4 },
  barWrap:         { alignItems: 'center', width: 50 },
  bar:             { width: 32, backgroundColor: '#F59E0B', borderRadius: 4, marginBottom: 4 },
  barAmt:          { color: '#94A3B8', fontSize: 9, marginBottom: 2, textAlign: 'center' },
  barDate:         { color: '#64748B', fontSize: 9, marginTop: 2 },
  barBills:        { color: '#475569', fontSize: 9 },
  methodRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  methodName:      { color: '#94A3B8', fontSize: 12, width: 56 },
  methodBarBg:     { flex: 1, height: 8, backgroundColor: '#0F172A', borderRadius: 4, overflow: 'hidden' },
  methodBarFill:   { height: 8, borderRadius: 4 },
  methodAmt:       { color: '#F1F5F9', fontSize: 11, width: 110, textAlign: 'right' },
  tableHeader:     { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#334155', marginBottom: 4 },
  th:              { flex: 1, color: '#475569', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  tableRow:        { flexDirection: 'row', paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4 },
  td:              { flex: 1, color: '#94A3B8', fontSize: 12 },
  billRow:         { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  billNo:          { color: '#F1F5F9', fontSize: 13, fontWeight: '700' },
  billPatient:     { color: '#94A3B8', fontSize: 12 },
  billCompany:     { color: '#475569', fontSize: 11 },
  billTotal:       { fontSize: 14, fontWeight: 'bold', marginBottom: 4 },
  billBadge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  billBadgeText:   { fontSize: 10, fontWeight: '700' },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyText:       { color: '#475569', fontSize: 16 },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:      { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  patItem:         { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  patItemSel:      { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  patName:         { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  modalCancel:     { marginTop: 12, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
