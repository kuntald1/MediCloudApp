import { authHeader, API_BASE, getToken, getUser } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Alert,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const STATUS_COLOR: Record<string, string> = { unpaid: '#EF4444', partial: '#F59E0B', paid: '#10B981', credit: '#8B5CF6' };

interface Bill {
  id: number; bill_no: string; patient_name: string; barcode: string;
  total: number; paid: number; status: string; created_at: string;
  organization_name?: string; discount_amount?: number; subtotal?: number;
  items?: any[]; payments?: any[]; phone?: string | null;
}

export default function Bills() {
  const isFranchise = getUser()?.role === 'franchise';
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [bills, setBills]       = useState<Bill[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState('all');

  // Detail modal
  const [sel, setSel]           = useState<Bill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [payingMethod, setPayingMethod]   = useState<string | null>(null);
  const [waPhone, setWaPhone]   = useState('');
  const [waBusy, setWaBusy]     = useState(false);
  const [waiting, setWaiting]   = useState(false);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const fetchBills = useCallback(async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const res  = await fetch(`${API_BASE}/api/billing/bills${params}`, { headers: authHeader() });
      const data = await res.json();
      setBills(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); fetchBills(); }, [fetchBills]);
  const onRefresh = async () => { setRefreshing(true); await fetchBills(); setRefreshing(false); };

  const filtered = bills.filter(b =>
    b.patient_name?.toLowerCase().includes(search.toLowerCase()) ||
    b.bill_no?.toLowerCase().includes(search.toLowerCase()) ||
    b.barcode?.toLowerCase().includes(search.toLowerCase())
  );

  // Open detail — fetch full bill (items + payments)
  const openBill = async (b: Bill) => {
    setSel(b); setDetailLoading(true); setWaPhone(b.phone ?? ''); setWaiting(false);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${b.id}`, { headers: authHeader() });
      if (res.ok) { const full = await res.json(); setSel(full); }
    } catch {} finally { setDetailLoading(false); }
  };

  const refreshDetail = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${id}`, { headers: authHeader() });
      if (res.ok) { const full = await res.json(); setSel(full); fetchBills(); return full; }
    } catch {}
    return null;
  }, [fetchBills]);

  const startPolling = useCallback((plinkId: string, billId: number) => {
    setWaiting(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const tok = getToken(); if (!tok) return;
        const res = await fetch(`${API_BASE}/api/billing/payment-link/${plinkId}/status`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!res.ok) return;
        const st = await res.json();
        if (st && st.paid) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setWaiting(false);
          await refreshDetail(billId);
          Alert.alert('✅ Payment received!');
        }
      } catch {}
    }, 4000);
  }, [refreshDetail]);

  // Download receipt PDF (token) → share
  const receipt = async (b: Bill) => {
    try {
      const tok = getToken();
      const fileUri = FileSystem.cacheDirectory + `Receipt_${b.bill_no}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/billing/bills/${b.id}/receipt`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Receipt not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${b.bill_no}` });
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const payCashUpi = async (method: 'cash' | 'upi') => {
    if (!sel) return;
    const due = Math.max(0, (sel.total || 0) - (sel.paid || 0));
    setPayingMethod(method);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${sel.id}/payments`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, amount: due }),
      });
      if (!res.ok) throw new Error('Payment failed');
      const updated = await res.json();
      setSel(updated); fetchBills();
      Alert.alert('✅ Paid', `${inr(due)} recorded (${method.toUpperCase()})`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPayingMethod(null); }
  };

  const payOnline = async () => {
    if (!sel) return;
    setPayingMethod('online');
    try {
      const tok = getToken();
      const res = await fetch(`${API_BASE}/api/billing/bills/${sel.id}/payment-link`, {
        method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? 'link failed'); }
      const data = await res.json();
      if (data.short_url) {
        if (data.id) startPolling(data.id, sel.id);
        await WebBrowser.openBrowserAsync(data.short_url);
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPayingMethod(null); }
  };

  const sendWhatsApp = async () => {
    if (!sel || !waPhone.trim()) { Alert.alert('Error', 'Enter WhatsApp number'); return; }
    setWaBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${sel.id}/send-whatsapp`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_number: waPhone.trim(), include_payment_link: true, save_patient_phone: true }),
      });
      if (!res.ok) throw new Error('WhatsApp failed');
      const out = await res.json();
      Alert.alert('✅ Sent', `Sent to ${waPhone.trim()}`);
      if (out.plink_id) startPolling(out.plink_id, sel.id);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setWaBusy(false); }
  };

  const closeDetail = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setWaiting(false); setSel(null);
  };

  const renderItem = ({ item: b }: { item: Bill }) => {
    const color   = STATUS_COLOR[b.status] ?? '#64748B';
    const balance = b.total - b.paid;
    return (
      <TouchableOpacity style={styles.card} onPress={() => openBill(b)}>
        <View style={styles.cardRow}>
          <Text style={styles.billNo}>🧾 {b.bill_no}</Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>● {b.status}</Text>
          </View>
        </View>
        <Text style={styles.patName}>{b.patient_name}</Text>
        <Text style={styles.barcode}>{b.barcode}</Text>
        <View style={styles.amtRow}>
          <View><Text style={styles.amtLabel}>Total</Text><Text style={styles.amtVal}>{inr(b.total)}</Text></View>
          <View><Text style={styles.amtLabel}>Paid</Text><Text style={[styles.amtVal, { color: '#10B981' }]}>{inr(b.paid)}</Text></View>
          <View><Text style={styles.amtLabel}>Balance</Text><Text style={[styles.amtVal, { color: balance > 0 ? '#EF4444' : '#10B981' }]}>{inr(balance)}</Text></View>
        </View>
        <Text style={styles.date}>🕐 {new Date(b.created_at).toLocaleString('en-IN')}  ·  Tap for details ›</Text>
      </TouchableOpacity>
    );
  };

  const due    = sel ? Math.max(0, (sel.total || 0) - (sel.paid || 0)) : 0;
  const isPaid = sel && due <= 0;
  const isCredit = sel?.status === 'credit';

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="🔍  Search bills..." placeholderTextColor="#475569" />
      </View>
      <View style={styles.filterRow}>
        {['all','unpaid','partial','paid','credit'].map(f => (
          <TouchableOpacity key={f} style={[styles.filterBtn, filter === f && styles.filterBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && { color: '#fff' }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.count}>{filtered.length} bill{filtered.length !== 1 ? 's' : ''}</Text>
      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={filtered} keyExtractor={(b, i) => (b.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🧾</Text><Text style={styles.emptyText}>No bills found</Text></View>}
        />
      )}

      {/* ── BILL DETAIL MODAL ── */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalBillNo}>{sel?.bill_no}</Text>
                <Text style={styles.modalSub}>{sel?.patient_name} · {sel?.barcode}</Text>
                {sel?.organization_name && <Text style={styles.modalOrg}>🏢 {sel.organization_name}</Text>}
              </View>
              <TouchableOpacity onPress={closeDetail}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>

            {detailLoading ? <ActivityIndicator color="#0EA5E9" style={{ marginVertical: 24 }} /> : (
              <ScrollView style={{ maxHeight: 460 }}>
                {/* Items */}
                {sel?.items && sel.items.length > 0 && (
                  <View style={styles.itemsBox}>
                    {sel.items.map((it, i) => (
                      <View key={i} style={styles.itemRow}>
                        <Text style={styles.itemName}>{it.test_name}</Text>
                        <Text style={styles.itemPrice}>{inr(it.price)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Totals */}
                <View style={styles.totalsBox}>
                  {sel?.subtotal != null && <View style={styles.tRow}><Text style={styles.tLabel}>Subtotal</Text><Text style={styles.tVal}>{inr(sel.subtotal)}</Text></View>}
                  {(sel?.discount_amount ?? 0) > 0 && <View style={styles.tRow}><Text style={styles.tLabel}>Discount</Text><Text style={[styles.tVal, { color: '#EF4444' }]}>– {inr(sel!.discount_amount!)}</Text></View>}
                  <View style={styles.tRow}><Text style={[styles.tLabel, { fontWeight: 'bold', color: '#F1F5F9' }]}>Total</Text><Text style={[styles.tVal, { fontWeight: 'bold', fontSize: 16 }]}>{inr(sel?.total ?? 0)}</Text></View>
                  <View style={styles.tRow}><Text style={styles.tLabel}>Paid</Text><Text style={[styles.tVal, { color: '#10B981' }]}>{inr(sel?.paid ?? 0)}</Text></View>
                  <View style={styles.tRow}><Text style={[styles.tLabel, { fontWeight: 'bold' }]}>Due</Text><Text style={[styles.tVal, { color: due > 0 ? '#EF4444' : '#10B981', fontWeight: 'bold' }]}>{inr(due)}</Text></View>
                </View>

                {/* Payments history */}
                {sel?.payments && sel.payments.length > 0 && (
                  <Text style={styles.payHist}>Payments: {sel.payments.map((p: any) => `${p.method ?? 'online'} ${inr(p.amount)}`).join(', ')}</Text>
                )}

                {/* ── UNPAID: payment options (lab only, not credit) ── */}
                {!isFranchise && !isPaid && !isCredit && (
                  <View style={styles.paySection}>
                    <Text style={styles.payLabel}>COLLECT PAYMENT</Text>
                    <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                      <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#16A34A' }]} onPress={() => payCashUpi('cash')} disabled={!!payingMethod || waiting}>
                        <Text style={styles.payBtnText}>{payingMethod === 'cash' ? '...' : '💵 Cash'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#8B5CF6' }]} onPress={() => payCashUpi('upi')} disabled={!!payingMethod || waiting}>
                        <Text style={styles.payBtnText}>{payingMethod === 'upi' ? '...' : '📲 UPI'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#3B82F6' }]} onPress={payOnline} disabled={!!payingMethod || waiting}>
                        <Text style={styles.payBtnText}>{payingMethod === 'online' ? '...' : '💳 Online'}</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.payLabel}>SEND PAYMENT LINK ON WHATSAPP</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput style={[styles.waInput, { flex: 1 }]} value={waPhone} onChangeText={setWaPhone}
                        placeholder="WhatsApp number" placeholderTextColor="#475569" keyboardType="phone-pad" editable={!waiting} />
                      <TouchableOpacity style={[styles.waBtn, waiting && { opacity: 0.5 }]} onPress={sendWhatsApp} disabled={waBusy || waiting}>
                        <Text style={styles.waBtnText}>{waBusy ? '...' : '💬 Send'}</Text>
                      </TouchableOpacity>
                    </View>
                    {waiting && (
                      <View style={styles.waitBox}>
                        <ActivityIndicator color="#8B5CF6" size="small" />
                        <Text style={styles.waitText}>Waiting for payment...</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Credit note */}
                {isCredit && (
                  <View style={styles.creditBox}>
                    <Text style={styles.creditText}>On credit — settle from Manage Credit / organization ledger.</Text>
                  </View>
                )}

                {/* Receipt actions — always */}
                <View style={styles.receiptRow}>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#F97316', flex: 1 }]} onPress={() => sel && receipt(sel)}>
                    <Text style={styles.payBtnText}>⬇ Download Receipt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#25D366', flex: 1 }]} onPress={sendWhatsApp}>
                    <Text style={styles.payBtnText}>💬 Send Receipt</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0F172A' },
  searchWrap:      { padding: 12, paddingBottom: 0 },
  search:          { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  filterRow:       { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  filterBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#334155', backgroundColor: '#1E293B' },
  filterBtnActive: { backgroundColor: '#0EA5E9', borderColor: '#0EA5E9' },
  filterText:      { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  count:           { color: '#475569', fontSize: 12, paddingHorizontal: 12, marginBottom: 4 },
  card:            { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  billNo:          { color: '#F1F5F9', fontSize: 14, fontWeight: 'bold' },
  badge:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:       { fontSize: 11, fontWeight: '700' },
  patName:         { color: '#F1F5F9', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  barcode:         { color: '#64748B', fontSize: 12, marginBottom: 6 },
  amtRow:          { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#0F172A', borderRadius: 8, padding: 10, marginVertical: 8 },
  amtLabel:        { color: '#64748B', fontSize: 11, marginBottom: 2 },
  amtVal:          { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  date:            { color: '#475569', fontSize: 11 },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalBillNo:     { color: '#F1F5F9', fontSize: 20, fontWeight: 'bold' },
  modalSub:        { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  modalOrg:        { color: '#6366f1', fontSize: 12, marginTop: 2 },
  closeX:          { color: '#64748B', fontSize: 22, padding: 4 },
  itemsBox:        { backgroundColor: '#0F172A', borderRadius: 8, padding: 10, marginBottom: 10 },
  itemRow:         { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemName:        { color: '#94A3B8', fontSize: 13, flex: 1 },
  itemPrice:       { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  totalsBox:       { marginBottom: 10 },
  tRow:            { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  tLabel:          { color: '#64748B', fontSize: 13 },
  tVal:            { color: '#F1F5F9', fontSize: 13 },
  payHist:         { color: '#475569', fontSize: 11, marginBottom: 10, fontStyle: 'italic' },
  paySection:      { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  payLabel:        { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  payBtn:          { flex: 1, padding: 11, borderRadius: 10, alignItems: 'center' },
  payBtnText:      { color: '#fff', fontWeight: '700', fontSize: 12 },
  waInput:         { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 11, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  waBtn:           { backgroundColor: '#25D366', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  waBtnText:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  waitBox:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10 },
  waitText:        { color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
  creditBox:       { backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#8B5CF633' },
  creditText:      { color: '#8B5CF6', fontSize: 13 },
  receiptRow:      { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
});
