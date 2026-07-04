import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Platform,
} from 'react-native';

interface LedgerEntry {
  id: number; patient_name: string; barcode: string; bill_no: string;
  test_name: string; package_name?: string | null;
  base_amount: number; commission_percent: number; commission_amount: number;
  is_paid: boolean; paid_at?: string | null; validated_at?: string | null; created_at: string;
}
interface LedgerResponse {
  matched: boolean;
  doctor?: { id: number; name: string; commission_percent: number };
  summary?: { earned: number; paid: number; outstanding: number; count: number };
  entries: LedgerEntry[];
}

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const toYMD = (d: Date) => { const p = (n: number) => n.toString().padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

export default function MyCommission() {
  const [data, setData]             = useState<LedgerResponse | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);

  const fetchLedger = useCallback(async (from?: string, to?: string) => {
    try {
      const params = new URLSearchParams();
      if (from) params.set('date_from', from);
      if (to)   params.set('date_to', to);
      const res  = await fetch(`${API_BASE}/api/commission/me/ledger?${params.toString()}`, { headers: authHeader() });
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchLedger(); }, []); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchLedger(fromDate, toDate); };
  const applyFilters = () => { setLoading(true); fetchLedger(fromDate, toDate); };
  const resetFilters = () => { setFromDate(''); setToDate(''); setLoading(true); fetchLedger(); };
  const activeFilterCount = [fromDate, toDate].filter(Boolean).length;

  if (loading && !data) {
    return <View style={styles.center}><ActivityIndicator color="#8B5CF6" size="large" /></View>;
  }

  if (data && data.matched === false) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyIcon}>💰</Text>
        <Text style={styles.emptyText}>No commission profile linked to your account</Text>
      </View>
    );
  }

  const summary = data?.summary;
  const doctor  = data?.doctor;
  const outstanding = summary?.outstanding ?? 0;

  return (
    <View style={styles.container}>
      <FlatList
        data={data?.entries ?? []}
        keyExtractor={(it) => it.id.toString()}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
        ListHeaderComponent={
          <View>
            {!!doctor && (
              <View style={styles.profileCard}>
                <Text style={styles.profileName}>{doctor.name}</Text>
                <Text style={styles.profilePct}>{doctor.commission_percent}% commission per test</Text>
              </View>
            )}

            <View style={styles.summaryRow}>
              <View style={styles.sumBox}>
                <Text style={styles.sumLabel}>Earned</Text>
                <Text style={styles.sumVal}>{inr(summary?.earned ?? 0)}</Text>
              </View>
              <View style={styles.sumBox}>
                <Text style={styles.sumLabel}>Paid</Text>
                <Text style={[styles.sumVal, { color: '#10B981' }]}>{inr(summary?.paid ?? 0)}</Text>
              </View>
              <View style={[styles.sumBox, outstanding > 0 && { borderTopColor: '#F97316', borderTopWidth: 2 }]}>
                <Text style={styles.sumLabel}>Outstanding</Text>
                <Text style={[styles.sumVal, { color: outstanding > 0 ? '#F97316' : '#64748B' }]}>{inr(outstanding)}</Text>
              </View>
            </View>

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
              <TouchableOpacity onPress={resetFilters} style={{ marginBottom: 10 }}>
                <Text style={styles.resetText}>✕ Clear date filter</Text>
              </TouchableOpacity>
            )}

            <Text style={styles.ledgerTitle}>Ledger · per test earned ({summary?.count ?? 0})</Text>
          </View>
        }
        renderItem={({ item: e }) => (
          <View style={styles.entryRow}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={styles.entryTest} numberOfLines={2}>
                {e.test_name}{e.package_name ? <Text style={styles.pkgTag}>  {e.package_name}</Text> : null}
              </Text>
              <Text style={styles.entryPatient}>{e.patient_name}</Text>
              <Text style={styles.entryMeta}>{e.bill_no} · {e.barcode} · {fmtDate(e.validated_at ?? e.created_at)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.entryComm}>{inr(e.commission_amount)}</Text>
              <Text style={styles.entryPct}>{e.commission_percent}% of {inr(e.base_amount)}</Text>
              <View style={[styles.paidBadge, { backgroundColor: e.is_paid ? '#10B98122' : '#F59E0B22' }]}>
                <Text style={[styles.paidBadgeText, { color: e.is_paid ? '#10B981' : '#F59E0B' }]}>{e.is_paid ? '✓ Paid' : 'Pending'}</Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={!loading ? (
          <Text style={styles.noData}>No entries{activeFilterCount > 0 ? ' in this range' : ''}</Text>
        ) : null}
      />

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
  container:      { flex: 1, backgroundColor: '#0F172A' },
  center:         { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#64748B', fontSize: 15, marginTop: 12, textAlign: 'center' },
  profileCard:    { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  profileName:    { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  profilePct:     { color: '#8B5CF6', fontSize: 12, marginTop: 3, fontWeight: '600' },
  summaryRow:     { flexDirection: 'row', gap: 8, marginBottom: 14 },
  sumBox:         { flex: 1, backgroundColor: '#1E293B', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  sumLabel:       { color: '#64748B', fontSize: 11, marginBottom: 4 },
  sumVal:         { color: '#F1F5F9', fontSize: 16, fontWeight: 'bold' },
  filterBar:      { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4 },
  filterLabel:    { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  dateBtn:        { backgroundColor: '#1E293B', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  applyBtn:       { backgroundColor: '#8B5CF6', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 8 },
  applyBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  resetText:      { color: '#EF4444', fontSize: 12 },
  ledgerTitle:    { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginTop: 6, marginBottom: 10 },
  entryRow:       { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#1E293B', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#334155' },
  entryTest:      { color: '#F1F5F9', fontSize: 13, fontWeight: '700' },
  pkgTag:         { color: '#64748B', fontSize: 11, fontWeight: '400' },
  entryPatient:   { color: '#94A3B8', fontSize: 12, marginTop: 3 },
  entryMeta:      { color: '#475569', fontSize: 11, marginTop: 3 },
  entryComm:      { color: '#10B981', fontSize: 15, fontWeight: 'bold' },
  entryPct:       { color: '#64748B', fontSize: 10, marginTop: 2 },
  paidBadge:      { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginTop: 6 },
  paidBadgeText:  { fontSize: 10, fontWeight: '700' },
  noData:         { color: '#475569', textAlign: 'center', marginTop: 24, fontSize: 13 },
});
