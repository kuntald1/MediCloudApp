import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Modal, RefreshControl, Platform,
} from 'react-native';

const toYMD = (d: Date) => { const p = (n: number) => n.toString().padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };

const STAGE_LABELS: Record<string, string> = {
  wait_for_pickup: 'Wait for Pickup', transit: 'Transit', receipt_accessioning: 'Receipt & Accessioning',
  testing: 'Testing', validation: 'Validation', reporting: 'Reporting',
};
const STAGE_LEGEND_LABELS: Record<string, string> = {
  wait_for_pickup: 'Wait for pickup', transit: 'Transit', receipt_accessioning: 'Receipt + accessioning',
  testing: 'Testing', validation: 'Validation', reporting: 'Reporting',
};
const STAGE_ICONS: Record<string, string> = {
  wait_for_pickup: '📦', transit: '🚚', receipt_accessioning: '📥', testing: '🔬', validation: '✅', reporting: '📄',
};
// Matches the color coding used on the web dashboard
const STAGE_COLORS: Record<string, string> = {
  wait_for_pickup: '#EF4444', transit: '#F59E0B', receipt_accessioning: '#3B82F6',
  testing: '#10B981', validation: '#8B5CF6', reporting: '#64748B',
};
const PHASE_COLORS: Record<string, string> = {
  pre_analytical: '#EF4444', analytical: '#10B981', post_analytical: '#8B5CF6',
};
const DEFAULT_STAGE_ORDER = ['wait_for_pickup', 'transit', 'receipt_accessioning', 'testing', 'validation', 'reporting'];

function fmtMin(m: number | null | undefined) {
  if (m == null) return '—';
  if (m < 60) return `${m.toFixed(1)}m`;
  const h = Math.floor(m / 60); const mm = Math.round(m % 60);
  return `${h}h ${mm}m`;
}

export default function TATReport() {
  const [data, setData]         = useState<any>(null);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedFranchise, setExpandedFranchise] = useState<number | null | 'none'>(null);

  // Filters
  const [franchiseId, setFranchiseId] = useState<number | null>(null);
  const [branchId, setBranchId]       = useState<number | null>(null);
  const [fromDate, setFromDate]       = useState('');
  const [toDate, setToDate]           = useState('');
  const [patientId, setPatientId]     = useState('');
  const [barcode, setBarcode]         = useState('');
  const [showFranchisePicker, setShowFranchisePicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker]       = useState(false);
  const [showFromPicker, setShowFromPicker]           = useState(false);
  const [showToPicker, setShowToPicker]               = useState(false);
  const [showFilters, setShowFilters]                 = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (franchiseId) params.set('franchise_id', String(franchiseId));
      if (branchId)    params.set('branch_id', String(branchId));
      if (fromDate)    params.set('date_from', fromDate);
      if (toDate)      params.set('date_to', toDate);
      if (patientId)   params.set('patient_id', patientId);
      if (barcode)     params.set('barcode', barcode);
      const res  = await fetch(`${API_BASE}/api/tat/by-franchise?${params.toString()}`, { headers: authHeader() });
      const json = await res.json();
      setData(json);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [franchiseId, branchId, fromDate, toDate, patientId, barcode]);

  useEffect(() => { setLoading(true); fetchData(); }, []); // eslint-disable-line
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };
  const applyFilters = () => { setLoading(true); setShowFilters(false); fetchData(); };
  const clearFilters = () => {
    setFranchiseId(null); setBranchId(null); setFromDate(''); setToDate(''); setPatientId(''); setBarcode('');
    setLoading(true); setShowFilters(false);
    setTimeout(fetchData, 50);
  };

  const activeFilterCount = [franchiseId, branchId, fromDate, toDate, patientId, barcode].filter(Boolean).length;

  const franchiseOptions = data?.filters?.franchises ?? [];
  const branchOptions    = data?.filters?.branches ?? [];
  const franchises       = data?.franchises ?? [];

  if (loading && !data) return <View style={styles.center}><ActivityIndicator color="#0EA5E9" size="large" /></View>;

  return (
    <View style={styles.container}>
      {/* Filter bar */}
      <View style={styles.filterBar}>
        <TouchableOpacity style={styles.filterToggle} onPress={() => setShowFilters(true)}>
          <Text style={styles.filterToggleText}>🔍 Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</Text>
        </TouchableOpacity>
        {activeFilterCount > 0 && (
          <TouchableOpacity onPress={clearFilters}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stage color legend — mirrors the web dashboard */}
      <View style={styles.legendRow}>
        {(data?.stage_order?.length ? data.stage_order : DEFAULT_STAGE_ORDER).map((stageKey: string) => (
          <View key={stageKey} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STAGE_COLORS[stageKey] ?? '#64748B' }]} />
            <Text style={styles.legendText}>{STAGE_LEGEND_LABELS[stageKey] ?? stageKey}</Text>
          </View>
        ))}
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>

        {loading ? <ActivityIndicator color="#0EA5E9" style={{ marginTop: 24 }} /> : franchises.length === 0 ? (
          <View style={styles.empty}><Text style={styles.emptyIcon}>⏱️</Text><Text style={styles.emptyText}>No TAT data for this filter</Text></View>
        ) : franchises.map((f: any, i: number) => {
          const isExpanded = expandedFranchise === (f.franchise_id ?? 'none');
          const stageKeys  = (data?.stage_order?.length ? data.stage_order : DEFAULT_STAGE_ORDER);
          const segments   = stageKeys.map((k: string) => ({ key: k, val: Math.max(0, f.stages?.[k]?.median ?? 0) }));
          const segTotal   = segments.reduce((s: number, seg: any) => s + seg.val, 0);
          return (
            <View key={i} style={styles.card}>
              <TouchableOpacity style={styles.cardHeader} onPress={() => setExpandedFranchise(isExpanded ? null : (f.franchise_id ?? 'none'))}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.franchiseName}>{f.franchise_name}</Text>
                  <Text style={styles.orderCount}>{f.order_count} order{f.order_count !== 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.totalBox}>
                  <Text style={styles.totalLabel}>Median Total</Text>
                  <Text style={styles.totalVal}>{fmtMin(f.total?.median)}</Text>
                </View>
                <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
              </TouchableOpacity>

              {/* Stacked stage bar — colors match the web dashboard legend */}
              <View style={styles.stageBar}>
                {segTotal > 0 ? segments.map((seg: any) => {
                  if (seg.val <= 0) return null;
                  const pct = seg.val / segTotal;
                  return (
                    <View key={seg.key} style={{ flex: pct, backgroundColor: STAGE_COLORS[seg.key] ?? '#64748B', minWidth: 3, justifyContent: 'center', alignItems: 'center' }}>
                      {pct > 0.08 && <Text style={styles.stageBarLabel}>{Math.round(seg.val)}</Text>}
                    </View>
                  );
                }) : <View style={{ flex: 1, backgroundColor: '#334155' }} />}
              </View>

              {/* Phases summary — always visible */}
              <View style={styles.phaseRow}>
                <View style={styles.phaseBox}>
                  <View style={styles.phaseLabelRow}><View style={[styles.legendDot, { backgroundColor: PHASE_COLORS.pre_analytical }]} /><Text style={styles.phaseLabel}>Pre-analytical</Text></View>
                  <Text style={styles.phaseVal}>{fmtMin(f.phases?.pre_analytical)}</Text>
                </View>
                <View style={styles.phaseBox}>
                  <View style={styles.phaseLabelRow}><View style={[styles.legendDot, { backgroundColor: PHASE_COLORS.analytical }]} /><Text style={styles.phaseLabel}>Analytical</Text></View>
                  <Text style={styles.phaseVal}>{fmtMin(f.phases?.analytical)}</Text>
                </View>
                <View style={styles.phaseBox}>
                  <View style={styles.phaseLabelRow}><View style={[styles.legendDot, { backgroundColor: PHASE_COLORS.post_analytical }]} /><Text style={styles.phaseLabel}>Post-analytical</Text></View>
                  <Text style={styles.phaseVal}>{fmtMin(f.phases?.post_analytical)}</Text>
                </View>
              </View>

              {/* Stage breakdown — expandable */}
              {isExpanded && (
                <View style={styles.stageSection}>
                  {(data?.stage_order ?? []).map((stageKey: string) => {
                    const s = f.stages?.[stageKey];
                    if (!s) return null;
                    return (
                      <View key={stageKey} style={styles.stageRow}>
                        <View style={[styles.legendDot, { backgroundColor: STAGE_COLORS[stageKey] ?? '#64748B', marginRight: 8 }]} />
                        <Text style={styles.stageIcon}>{STAGE_ICONS[stageKey] ?? '•'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.stageName}>{STAGE_LABELS[stageKey] ?? stageKey}</Text>
                          <Text style={styles.stageN}>n={s.n}</Text>
                        </View>
                        <View style={styles.stageStats}>
                          <Text style={styles.stageStatLabel}>Median</Text>
                          <Text style={styles.stageStatVal}>{fmtMin(s.median)}</Text>
                        </View>
                        <View style={styles.stageStats}>
                          <Text style={styles.stageStatLabel}>Avg</Text>
                          <Text style={styles.stageStatVal}>{fmtMin(s.avg)}</Text>
                        </View>
                        <View style={styles.stageStats}>
                          <Text style={styles.stageStatLabel}>P90</Text>
                          <Text style={[styles.stageStatVal, { color: '#F59E0B' }]}>{fmtMin(s.p90)}</Text>
                        </View>
                      </View>
                    );
                  })}
                  <View style={styles.totalStatsRow}>
                    <Text style={styles.totalStatsLabel}>TOTAL (n={f.total?.n})</Text>
                    <Text style={styles.totalStatsVal}>Median {fmtMin(f.total?.median)} · Avg {fmtMin(f.total?.avg)} · P90 {fmtMin(f.total?.p90)}</Text>
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* ── FILTERS MODAL ── */}
      <Modal visible={showFilters} transparent animationType="slide" onRequestClose={() => setShowFilters(false)}>
        <View style={styles.overlay}>
          <View style={styles.filterBox}>
            <Text style={styles.modalTitle}>🔍 Filters</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={styles.fieldLabel}>Franchise</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowFranchisePicker(true)}>
                <Text style={{ color: franchiseId ? '#F1F5F9' : '#475569' }}>
                  {franchiseOptions.find((f: any) => f.id === franchiseId)?.name ?? 'All Franchises'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Branch</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowBranchPicker(true)}>
                <Text style={{ color: branchId ? '#F1F5F9' : '#475569' }}>
                  {branchOptions.find((b: any) => b.id === branchId)?.name ?? 'All Branches'}
                </Text>
              </TouchableOpacity>

              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>From</Text>
                  <TouchableOpacity style={styles.input} onPress={() => setShowFromPicker(true)}>
                    <Text style={{ color: fromDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{fromDate || 'From date'}</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>To</Text>
                  <TouchableOpacity style={styles.input} onPress={() => setShowToPicker(true)}>
                    <Text style={{ color: toDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{toDate || 'To date'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Patient ID</Text>
              <TextInput style={styles.input} value={patientId} onChangeText={setPatientId}
                placeholder="e.g. 23" placeholderTextColor="#475569" keyboardType="numeric" />

              <Text style={styles.fieldLabel}>Barcode</Text>
              <TextInput style={styles.input} value={barcode} onChangeText={setBarcode}
                placeholder="e.g. KD-22" placeholderTextColor="#475569" />
            </ScrollView>

            <View style={styles.filterBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowFilters(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
                <Text style={styles.applyText}>Apply Filters</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Franchise picker */}
      <Modal visible={showFranchisePicker} transparent animationType="fade" onRequestClose={() => setShowFranchisePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Franchise</Text>
            <TouchableOpacity style={styles.pickerItem} onPress={() => { setFranchiseId(null); setShowFranchisePicker(false); }}>
              <Text style={styles.pickerText}>All Franchises</Text>
            </TouchableOpacity>
            {franchiseOptions.map((f: any) => (
              <TouchableOpacity key={f.id} style={styles.pickerItem} onPress={() => { setFranchiseId(f.id); setShowFranchisePicker(false); }}>
                <Text style={styles.pickerText}>{f.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowFranchisePicker(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Branch picker */}
      <Modal visible={showBranchPicker} transparent animationType="fade" onRequestClose={() => setShowBranchPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Branch</Text>
            <TouchableOpacity style={styles.pickerItem} onPress={() => { setBranchId(null); setShowBranchPicker(false); }}>
              <Text style={styles.pickerText}>All Branches</Text>
            </TouchableOpacity>
            {branchOptions.map((b: any) => (
              <TouchableOpacity key={b.id} style={styles.pickerItem} onPress={() => { setBranchId(b.id); setShowBranchPicker(false); }}>
                <Text style={styles.pickerText}>{b.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowBranchPicker(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Date pickers */}
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
  center:         { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  filterBar:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  filterToggle:   { backgroundColor: '#1E293B', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  filterToggleText:{ color: '#0EA5E9', fontWeight: '600', fontSize: 13 },
  clearText:      { color: '#EF4444', fontSize: 12 },
  legendRow:      { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, paddingBottom: 10, gap: 12 },
  legendItem:     { flexDirection: 'row', alignItems: 'center' },
  legendDot:      { width: 8, height: 8, borderRadius: 4 },
  legendText:     { color: '#94A3B8', fontSize: 10, marginLeft: 5 },
  stageBar:       { flexDirection: 'row', height: 30, marginHorizontal: 14, marginBottom: 12, borderRadius: 8, overflow: 'hidden' },
  stageBarLabel:  { color: '#F1F5F9', fontSize: 11, fontWeight: '700' },
  phaseLabelRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  card:           { backgroundColor: '#1E293B', borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#334155', overflow: 'hidden' },
  cardHeader:     { flexDirection: 'row', alignItems: 'center', padding: 14 },
  franchiseName:  { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  orderCount:     { color: '#64748B', fontSize: 12, marginTop: 2 },
  totalBox:       { alignItems: 'flex-end', marginRight: 10 },
  totalLabel:     { color: '#64748B', fontSize: 10 },
  totalVal:       { color: '#0EA5E9', fontSize: 15, fontWeight: 'bold' },
  expandIcon:     { color: '#475569', fontSize: 12 },
  phaseRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 },
  phaseBox:       { flex: 1, backgroundColor: '#0F172A', borderRadius: 8, padding: 8, alignItems: 'center' },
  phaseLabel:     { color: '#64748B', fontSize: 9, marginLeft: 5 },
  phaseVal:       { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  stageSection:   { borderTopWidth: 1, borderTopColor: '#334155', padding: 14 },
  stageRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#0F172A' },
  stageIcon:      { fontSize: 16, marginRight: 10 },
  stageName:      { color: '#F1F5F9', fontSize: 12, fontWeight: '600' },
  stageN:         { color: '#475569', fontSize: 10, marginTop: 1 },
  stageStats:     { alignItems: 'center', width: 52 },
  stageStatLabel: { color: '#475569', fontSize: 9 },
  stageStatVal:   { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginTop: 1 },
  totalStatsRow:  { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#334155' },
  totalStatsLabel:{ color: '#0EA5E9', fontSize: 11, fontWeight: '700' },
  totalStatsVal:  { color: '#94A3B8', fontSize: 11, marginTop: 4 },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  filterBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  fieldLabel:     { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:          { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  dateRow:        { flexDirection: 'row', gap: 10 },
  filterBtns:     { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn:      { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:     { color: '#94A3B8', fontWeight: '600' },
  applyBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#0EA5E9', alignItems: 'center' },
  applyText:      { color: '#fff', fontWeight: '700' },
  pickerBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerItem:     { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerText:     { color: '#F1F5F9', fontSize: 14 },
  modalCancel:    { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
});
