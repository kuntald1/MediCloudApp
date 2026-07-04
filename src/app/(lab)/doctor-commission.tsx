import { authHeader, API_BASE } from '../../../src/utils/auth';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, ScrollView, TextInput, Alert, Switch, Platform,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const toYMD = (d: Date) => { const p = (n: number) => n.toString().padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

interface Doctor {
  id: number; name: string; phone?: string | null;
  commission_percent: number; earned?: number; paid?: number; outstanding?: number;
  has_login?: boolean; is_registered?: boolean;
}

export default function DoctorCommission() {
  const [doctors, setDoctors]   = useState<Doctor[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Ledger modal
  const [sel, setSel]           = useState<Doctor | null>(null);
  const [ledger, setLedger]     = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate]     = useState('');
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);
  const [paying, setPaying]     = useState(false);

  // Add/Edit doctor modal
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState<{ id?: number; name: string; phone: string; commission_percent: string }>({ name: '', phone: '', commission_percent: '0' });
  const [savingDoc, setSavingDoc] = useState(false);

  const fetchDoctors = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/commission/doctors`, { headers: authHeader() });
      const data = await res.json();
      setDoctors(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchDoctors(); }, [fetchDoctors]);
  const onRefresh = async () => { setRefreshing(true); await fetchDoctors(); setRefreshing(false); };

  // ── Ledger ──
  const openLedger = async (doc: Doctor, from = '', to = '') => {
    setSel(doc); setLedgerLoading(true); setLedger(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('date_from', from);
      if (to)   qs.set('date_to', to);
      const res  = await fetch(`${API_BASE}/api/commission/doctors/${doc.id}/ledger?${qs.toString()}`, { headers: authHeader() });
      const data = await res.json();
      setLedger(data);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLedgerLoading(false); }
  };

  const applyLedgerFilter = () => { if (sel) openLedger(sel, fromDate, toDate); };
  const clearLedgerFilter = () => { setFromDate(''); setToDate(''); if (sel) openLedger(sel, '', ''); };

  // ── Pay ──
  const payNow = () => {
    if (!sel || !ledger) return;
    const outstanding = ledger.summary?.outstanding ?? 0;
    if (outstanding <= 0) return;
    Alert.alert('Settle Commission', `Pay ${inr(outstanding)} to ${sel.name}?${fromDate || toDate ? '\\n(within selected date range)' : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Pay', onPress: async () => {
        setPaying(true);
        try {
          const payload: any = {};
          if (fromDate) payload.date_from = fromDate;
          if (toDate)   payload.date_to   = toDate;
          const res = await fetch(`${API_BASE}/api/commission/doctors/${sel.id}/pay`, {
            method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const j = await res.json();
          if (res.ok && j.ok) {
            Alert.alert('✅ Paid', `${inr(j.paid)} paid · ${j.entries_settled} entr${j.entries_settled === 1 ? 'y' : 'ies'} settled`);
            openLedger(sel, fromDate, toDate);
            fetchDoctors();
          } else { Alert.alert('Error', 'Payment failed'); }
        } catch (e: any) { Alert.alert('Error', e.message); }
        finally { setPaying(false); }
      }},
    ]);
  };

  // ── Add/Edit doctor ──
  const openAdd  = () => { setForm({ name: '', phone: '', commission_percent: '0' }); setShowForm(true); };
  const openEdit = (d: Doctor) => { setForm({ id: d.id, name: d.name, phone: d.phone ?? '', commission_percent: String(d.commission_percent) }); setShowForm(true); };

  const saveDoctor = async () => {
    if (!form.name.trim()) { Alert.alert('Error', 'Name required'); return; }
    setSavingDoc(true);
    try {
      const url    = form.id ? `${API_BASE}/api/b2b/referral-doctors/${form.id}` : `${API_BASE}/api/b2b/referral-doctors`;
      const method = form.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), phone: form.phone || null, commission_percent: Number(form.commission_percent) || 0 }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', form.id ? 'Doctor updated' : 'Doctor added');
        setShowForm(false); fetchDoctors();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSavingDoc(false); }
  };

  const deleteDoctor = (d: Doctor) => Alert.alert('Delete Doctor', `Remove ${d.name}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/b2b/referral-doctors/${d.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { Alert.alert('Deleted'); fetchDoctors(); }
        else { Alert.alert('Error', 'Could not delete (may have ledger entries)'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  const renderDoctor = ({ item: d }: { item: Doctor }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.docName}>👨‍⚕️ {d.name}</Text>
          <View style={styles.tagRow}>
            {d.is_registered !== false && <View style={styles.regTag}><Text style={styles.regTagText}>✓ Registered</Text></View>}
            {d.has_login && <View style={styles.loginTag}><Text style={styles.loginTagText}>🩺 Login</Text></View>}
          </View>
        </View>
        <Text style={styles.commPct}>{d.commission_percent}%</Text>
      </View>

      <View style={styles.amtRow}>
        <View style={styles.amtBox}><Text style={styles.amtLabel}>Earned</Text><Text style={styles.amtVal}>{inr(d.earned ?? 0)}</Text></View>
        <View style={styles.amtBox}><Text style={styles.amtLabel}>Paid</Text><Text style={[styles.amtVal, { color: '#10B981' }]}>{inr(d.paid ?? 0)}</Text></View>
        <View style={styles.amtBox}><Text style={styles.amtLabel}>Outstanding</Text><Text style={[styles.amtVal, { color: (d.outstanding ?? 0) > 0 ? '#F97316' : '#64748B' }]}>{inr(d.outstanding ?? 0)}</Text></View>
      </View>

      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.ledgerBtn} onPress={() => { setFromDate(''); setToDate(''); openLedger(d); }}>
          <Text style={styles.ledgerBtnText}>Ledger →</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(d)}>
          <Text style={styles.editBtnText}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.delBtn} onPress={() => deleteDoctor(d)}>
          <Text style={styles.delBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const outstanding = ledger?.summary?.outstanding ?? 0;

  return (
    <View style={styles.container}>
      {/* Add doctor button */}
      <TouchableOpacity style={styles.addDocBtn} onPress={openAdd}>
        <Text style={styles.addDocText}>+ Add Referral Doctor</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#8B5CF6" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={doctors} keyExtractor={(d, i) => (d.id ?? i).toString()} renderItem={renderDoctor}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>💊</Text><Text style={styles.emptyText}>No doctors yet</Text></View>}
        />
      )}

      {/* ── LEDGER MODAL ── */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <View style={styles.overlay}>
          <View style={styles.ledgerBox}>
            <View style={styles.ledgerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.ledgerName}>{sel?.name}</Text>
                <Text style={styles.ledgerSub}>
                  {sel?.phone || 'No phone'} · {sel?.commission_percent}% commission
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSel(null)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>

            {ledgerLoading ? <ActivityIndicator color="#8B5CF6" style={{ marginVertical: 30 }} /> : ledger && (
              <ScrollView style={{ maxHeight: 500 }}>
                {/* Summary cards */}
                <View style={styles.summaryRow}>
                  <View style={styles.sumBox}><Text style={styles.sumLabel}>Earned</Text><Text style={styles.sumVal}>{inr(ledger.summary?.earned ?? 0)}</Text></View>
                  <View style={styles.sumBox}><Text style={styles.sumLabel}>Paid</Text><Text style={[styles.sumVal, { color: '#10B981' }]}>{inr(ledger.summary?.paid ?? 0)}</Text></View>
                  <View style={[styles.sumBox, outstanding > 0 && { borderTopColor: '#F97316', borderTopWidth: 2 }]}><Text style={styles.sumLabel}>Outstanding</Text><Text style={[styles.sumVal, { color: outstanding > 0 ? '#F97316' : '#64748B' }]}>{inr(outstanding)}</Text></View>
                </View>

                {/* Date filter */}
                <View style={styles.filterRow}>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowFromPicker(true)}>
                    <Text style={{ color: fromDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{fromDate || 'From'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dateBtn} onPress={() => setShowToPicker(true)}>
                    <Text style={{ color: toDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{toDate || 'To'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.filterApply} onPress={applyLedgerFilter}>
                    <Text style={styles.filterApplyText}>Apply</Text>
                  </TouchableOpacity>
                  {(fromDate || toDate) ? (
                    <TouchableOpacity style={styles.filterClear} onPress={clearLedgerFilter}>
                      <Text style={styles.filterClearText}>Clear</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Pay button */}
                <TouchableOpacity style={[styles.payBtn, outstanding <= 0 && { opacity: 0.4 }]}
                  onPress={payNow} disabled={paying || outstanding <= 0}>
                  {paying ? <ActivityIndicator color="#fff" /> : <Text style={styles.payBtnText}>💰 Pay {inr(outstanding)}</Text>}
                </TouchableOpacity>

                {/* Ledger entries */}
                <Text style={styles.ledgerTitle}>Ledger · per test earned</Text>
                {(ledger.entries ?? []).map((e: any, i: number) => (
                  <View key={e.id ?? i} style={styles.entryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryTest}>{e.test_name}{e.package_name ? <Text style={styles.pkgTag}>  {e.package_name}</Text> : null}</Text>
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
                ))}
                {(ledger.entries ?? []).length === 0 && <Text style={styles.noData}>No entries in this range</Text>}
              </ScrollView>
            )}
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

      {/* ── ADD/EDIT DOCTOR MODAL ── */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{form.id ? '✏️ Edit Doctor' : '➕ Add Referral Doctor'}</Text>
            <Text style={styles.hint}>Commission is earned when the doctor validates a report.</Text>

            <Text style={styles.fieldLabel}>Doctor Name *</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))}
              placeholder="Dr. Name" placeholderTextColor="#475569" />

            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))}
              placeholder="Optional" placeholderTextColor="#475569" keyboardType="phone-pad" />

            <Text style={styles.fieldLabel}>Commission %</Text>
            <TextInput style={styles.input} value={form.commission_percent} onChangeText={v => setForm(f => ({ ...f, commission_percent: v }))}
              placeholder="0" placeholderTextColor="#475569" keyboardType="numeric" />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveDoctor} disabled={savingDoc}>
                <Text style={styles.saveText}>{savingDoc ? 'Saving...' : (form.id ? 'Update' : 'Add Doctor')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0F172A' },
  addDocBtn:     { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addDocText:    { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:          { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  docName:       { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  tagRow:        { flexDirection: 'row', gap: 6, marginTop: 4 },
  regTag:        { backgroundColor: '#10B98122', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  regTagText:    { color: '#10B981', fontSize: 10, fontWeight: '600' },
  loginTag:      { backgroundColor: '#3B82F622', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  loginTagText:  { color: '#3B82F6', fontSize: 10, fontWeight: '600' },
  commPct:       { color: '#8B5CF6', fontSize: 16, fontWeight: '700' },
  amtRow:        { flexDirection: 'row', gap: 8, marginBottom: 10 },
  amtBox:        { flex: 1, backgroundColor: '#0F172A', borderRadius: 8, padding: 8, alignItems: 'center' },
  amtLabel:      { color: '#64748B', fontSize: 10, marginBottom: 2 },
  amtVal:        { color: '#F1F5F9', fontSize: 13, fontWeight: 'bold' },
  actionRow:     { flexDirection: 'row', gap: 8 },
  ledgerBtn:     { flex: 1, backgroundColor: '#F59E0B22', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#F59E0B44' },
  ledgerBtnText: { color: '#F59E0B', fontWeight: '700', fontSize: 13 },
  editBtn:       { backgroundColor: '#3B82F622', paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { fontSize: 14 },
  delBtn:        { backgroundColor: '#EF444422', paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: '#EF444444' },
  delBtnText:    { fontSize: 14 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  ledgerBox:     { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28, maxHeight: '90%' },
  ledgerHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  ledgerName:    { color: '#F1F5F9', fontSize: 20, fontWeight: 'bold' },
  ledgerSub:     { color: '#64748B', fontSize: 12, marginTop: 2 },
  closeX:        { color: '#64748B', fontSize: 22 },
  summaryRow:    { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sumBox:        { flex: 1, backgroundColor: '#0F172A', borderRadius: 10, padding: 12, alignItems: 'center' },
  sumLabel:      { color: '#64748B', fontSize: 10, marginBottom: 4 },
  sumVal:        { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  filterRow:     { flexDirection: 'row', gap: 6, marginBottom: 10, alignItems: 'center' },
  dateBtn:       { flex: 1, backgroundColor: '#0F172A', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  filterApply:   { backgroundColor: '#0EA5E9', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  filterApplyText:{ color: '#fff', fontWeight: '700', fontSize: 12 },
  filterClear:   { paddingHorizontal: 10, paddingVertical: 10 },
  filterClearText:{ color: '#EF4444', fontSize: 12 },
  payBtn:        { backgroundColor: '#16A34A', padding: 13, borderRadius: 10, alignItems: 'center', marginBottom: 16 },
  payBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  ledgerTitle:   { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  entryRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  entryTest:     { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  pkgTag:        { color: '#F59E0B', fontSize: 10 },
  entryMeta:     { color: '#64748B', fontSize: 11, marginTop: 2 },
  entryComm:     { color: '#F1F5F9', fontSize: 14, fontWeight: 'bold' },
  entryPct:      { color: '#64748B', fontSize: 10, marginTop: 2 },
  paidBadge:     { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  paidBadgeText: { fontSize: 10, fontWeight: '600' },
  noData:        { color: '#64748B', textAlign: 'center', paddingVertical: 24 },
  formBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  hint:          { color: '#64748B', fontSize: 12, marginBottom: 16 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:         { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#8B5CF6', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
});
