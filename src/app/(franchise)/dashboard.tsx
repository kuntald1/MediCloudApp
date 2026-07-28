import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, Platform,
} from 'react-native';

const pad = (n: number) => n.toString().padStart(2, '0');
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt  = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: '2-digit', month: '2-digit', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '';

const today = new Date();
const todayStr = toYMD(today);
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toYMD(d); };

const STATUS_COLOR: Record<string, string> = { paid: '#10B981', unpaid: '#EF4444', credit: '#8B5CF6', partial: '#F59E0B' };

const KPI_CARDS: { key: string; label: string; color: string; fmt: (k: any) => string; sub?: (k: any) => string }[] = [
  { key: 'billed',    label: 'Billed',    color: '#17B9A1', fmt: k => fmt(k.billed) },
  { key: 'collected', label: 'Collected', color: '#10B981', fmt: k => fmt(k.collected) },
  { key: 'balance',   label: 'Balance',   color: '#EF4444', fmt: k => fmt(k.balance) },
  { key: 'bills',     label: 'Bills',     color: '#6366F1', fmt: k => String(k.bills ?? 0) },
  { key: 'discount',  label: 'Discount',  color: '#F59E0B', fmt: k => fmt(k.discount) },
  { key: 'credit',    label: 'Credit',    color: '#A855F7', fmt: k => fmt(k.credit) },
];

export default function FranchiseDashboard() {
  const [franchiseId, setFranchiseId]   = useState<number | null>(null);
  const [franchiseName, setFranchiseName] = useState('');
  const [data, setData]                 = useState<any>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]     = useState(false);

  const [fromDate, setFromDate] = useState(daysAgo(29));
  const [toDate, setToDate]     = useState(todayStr);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);
  const [activeRange, setActiveRange]       = useState<'today' | '7d' | '30d' | '90d' | null>('30d');

  // Resolve the logged-in user's own franchise once
  const fetchFranchise = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() });
      const list = await res.json();
      const mine = Array.isArray(list) ? list[0] : null;
      if (mine) { setFranchiseId(mine.id); setFranchiseName(mine.name); }
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { fetchFranchise(); }, [fetchFranchise]);

  const fetchDashboard = useCallback(async (from: string, to: string) => {
    if (!franchiseId) return;
    try {
      const res  = await fetch(
        `${API_BASE}/api/reports2/dashboard?franchise_id=${franchiseId}&date_from=${from}&date_to=${to}`,
        { headers: authHeader() }
      );
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [franchiseId]);

  useEffect(() => {
    if (franchiseId) { setLoading(true); fetchDashboard(fromDate, toDate); }
  }, [franchiseId]); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchDashboard(fromDate, toDate); };
  const applyDates = () => { setActiveRange(null); setLoading(true); fetchDashboard(fromDate, toDate); };

  const quickRange = (r: 'today' | '7d' | '30d' | '90d') => {
    const from = r === 'today' ? todayStr : r === '7d' ? daysAgo(6) : r === '30d' ? daysAgo(29) : daysAgo(89);
    setFromDate(from); setToDate(todayStr); setActiveRange(r);
    setLoading(true); fetchDashboard(from, todayStr);
  };

  const kpis      = data?.kpis;
  const daily     = data?.daily ?? [];
  const methods   = data?.methods ?? [];
  const breakdown = data?.breakdown ?? [];
  const recent    = data?.recent ?? [];
  const maxBilled = Math.max(...daily.map((d: any) => d.billed), 1);

  return (
    <ScrollView style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}>

      {!!franchiseName && <Text style={styles.franchiseName}>{franchiseName}</Text>}

      {/* Date range filter */}
      <View style={styles.filterBar}>
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
        <TouchableOpacity style={styles.applyBtn} onPress={applyDates}>
          <Text style={styles.applyBtnText}>Apply</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.quickRow}>
        {(['today', '7d', '30d', '90d'] as const).map(r => (
          <TouchableOpacity key={r} style={[styles.quickBtn, activeRange === r && styles.quickBtnActive]} onPress={() => quickRange(r)}>
            <Text style={[styles.quickBtnText, activeRange === r && { color: '#fff' }]}>
              {r === 'today' ? 'Today' : r}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : !kpis ? (
        <View style={styles.empty}><Text style={styles.emptyText}>No data</Text></View>
      ) : (
        <>
          {/* KPI Cards */}
          <View style={styles.kpiGrid}>
            {KPI_CARDS.map(c => (
              <View key={c.key} style={[styles.kpiCard, { borderTopColor: c.color }]}>
                <Text style={styles.kpiLabel}>{c.label}</Text>
                <Text style={[styles.kpiVal, { color: c.color }]} numberOfLines={1} adjustsFontSizeToFit>{c.fmt(kpis)}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.avgBillNote}>Avg bill {fmt(kpis.avg_bill)}</Text>

          {/* Daily Revenue */}
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

          {/* Payment Methods */}
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
                      <View style={[styles.methodBarFill, { width: `${pct}%`, backgroundColor: i === 0 ? '#17B9A1' : '#10B981' }]} />
                    </View>
                    <Text style={styles.methodAmt}>{fmt(m.amount)} ({pct}%)</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Franchise Breakdown */}
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
                <View key={i} style={[styles.tableRow, i % 2 === 0 && { backgroundColor: '#F8FAFC' }]}>
                  <Text style={[styles.td, { flex: 2, color: '#0F172A' }]} numberOfLines={1}>{b.company}</Text>
                  <Text style={styles.td}>{b.bills}</Text>
                  <Text style={[styles.td, { color: '#10B981' }]}>{fmt(b.billed)}</Text>
                  <Text style={[styles.td, { color: '#17B9A1' }]}>{b.share}%</Text>
                </View>
              ))}
            </View>
          )}

        </>
      )}
      <View style={{ height: 32 }} />

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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F8FAFC' },
  franchiseName:   { color: '#0F172A', fontSize: 16, fontWeight: 'bold', marginTop: 12, marginHorizontal: 12 },
  filterBar:       { flexDirection: 'row', alignItems: 'flex-end', padding: 12, paddingBottom: 8 },
  filterLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  dateBtn:         { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center' },
  dateBtnText:     { color: '#0F172A', fontSize: 12 },
  applyBtn:        { backgroundColor: '#F97316', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  applyBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  quickRow:        { flexDirection: 'row', paddingHorizontal: 12, gap: 8, marginBottom: 6 },
  quickBtn:        { flex: 1, padding: 9, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', alignItems: 'center' },
  quickBtnActive:  { backgroundColor: '#F97316', borderColor: '#F97316' },
  quickBtnText:    { color: '#64748B', fontWeight: '600', fontSize: 12 },
  kpiGrid:         { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, marginTop: 10 },
  kpiCard:         { width: '31%', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderTopWidth: 3 },
  kpiLabel:        { color: '#64748B', fontSize: 10, fontWeight: '600', marginBottom: 6 },
  kpiVal:          { fontSize: 15, fontWeight: 'bold' },
  avgBillNote:     { color: '#475569', fontSize: 11, marginHorizontal: 12, marginTop: 8 },
  section:         { marginHorizontal: 12, marginBottom: 12, marginTop: 12, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionTitle:    { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  barChart:        { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 10, paddingBottom: 4 },
  barWrap:         { alignItems: 'center', width: 54 },
  bar:             { width: 32, backgroundColor: '#F59E0B', borderRadius: 4, marginBottom: 4 },
  barAmt:          { color: '#94A3B8', fontSize: 9, marginBottom: 2, textAlign: 'center' },
  barDate:         { color: '#64748B', fontSize: 9, marginTop: 2 },
  barBills:        { color: '#475569', fontSize: 9 },
  methodRow:       { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  methodName:      { color: '#94A3B8', fontSize: 12, width: 56 },
  methodBarBg:     { flex: 1, height: 8, backgroundColor: '#F8FAFC', borderRadius: 4, overflow: 'hidden' },
  methodBarFill:   { height: 8, borderRadius: 4 },
  methodAmt:       { color: '#0F172A', fontSize: 11, width: 110, textAlign: 'right' },
  tableHeader:     { flexDirection: 'row', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', marginBottom: 4 },
  th:              { flex: 1, color: '#475569', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  tableRow:        { flexDirection: 'row', paddingVertical: 8, borderRadius: 6, paddingHorizontal: 4 },
  td:              { flex: 1, color: '#94A3B8', fontSize: 12 },
  billRow:         { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  billNo:          { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  billPatient:     { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  billMeta:        { color: '#475569', fontSize: 10, marginTop: 2 },
  billTotal:       { fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  billPaid:        { color: '#475569', fontSize: 10, marginBottom: 4 },
  billBadge:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  billBadgeText:   { fontSize: 10, fontWeight: '700' },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyText:       { color: '#475569', fontSize: 16 },
});
