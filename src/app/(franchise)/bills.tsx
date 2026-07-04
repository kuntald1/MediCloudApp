import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Alert, Switch, Platform,
} from 'react-native';

interface BillItem { test_id: number; test_name: string; mrp: number; price: number; price_source?: string; package_id?: number | null; package_name?: string | null; }
interface Bill {
  id: number; bill_no: string; patient_id: number; patient_name: string; barcode: string;
  phone: string | null; organization_id: number | null; organization_name: string | null;
  subtotal: number; discount_type: string | null; discount_value: number; discount_amount: number;
  total: number; paid: number; status: string; created_at: string;
  items: BillItem[]; payments: any[];
}
interface Org { id: number; name: string; }

const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const pad = (n: number) => n.toString().padStart(2, '0');
const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '';

const STATUS_COLOR: Record<string, string> = { paid: '#10B981', unpaid: '#EF4444', credit: '#8B5CF6', partial: '#F59E0B' };
const STATUS_LABEL: Record<string, string> = { paid: 'Paid', unpaid: 'Unpaid', credit: 'On Credit', partial: 'Partial' };

export default function FranchiseBills() {
  const [bills, setBills]           = useState<Bill[]>([]);
  const [orgs, setOrgs]             = useState<Org[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [orgId, setOrgId]           = useState<number | null>(null);
  const [barcode, setBarcode]       = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [showOrgPicker, setShowOrgPicker]   = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker]     = useState(false);

  // Detail / pay modal
  const [sel, setSel]           = useState<Bill | null>(null);
  const [waPhone, setWaPhone]   = useState('');
  const [includeLink, setIncludeLink] = useState(true);
  const [sending, setSending]   = useState(false);
  const [pdfLoading, setPdfLoading] = useState<number | null>(null);

  const fetchOrgs = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/organizations`, { headers: authHeader() });
      const data = await res.json();
      setOrgs(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  const fetchBills = useCallback(async (o?: number | null, bc?: string, from?: string, to?: string) => {
    try {
      const params = new URLSearchParams();
      if (o)          params.set('organization_id', String(o));
      if (bc?.trim()) params.set('barcode', bc.trim());
      if (from)       params.set('date_from', from);
      if (to)         params.set('date_to', to);
      const qs  = params.toString();
      const res = await fetch(`${API_BASE}/api/billing/bills${qs ? `?${qs}` : ''}`, { headers: authHeader() });
      const data = await res.json();
      setBills(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchOrgs(); fetchBills(); }, []); // eslint-disable-line

  const onRefresh = () => { setRefreshing(true); fetchBills(orgId, barcode, fromDate, toDate); };
  const applyFilters = () => { setLoading(true); fetchBills(orgId, barcode, fromDate, toDate); };
  const clearFilters = () => {
    setOrgId(null); setBarcode(''); setFromDate(''); setToDate('');
    setLoading(true); fetchBills();
  };
  const activeFilterCount = [orgId != null, !!barcode.trim(), !!fromDate, !!toDate].filter(Boolean).length;

  const openBill = (b: Bill) => { setSel(b); setWaPhone(b.phone ?? ''); setIncludeLink(true); };
  const closeBill = () => setSel(null);

  const sendWhatsApp = async () => {
    if (!sel || !waPhone.trim()) { Alert.alert('Error', 'Enter a WhatsApp number'); return; }
    setSending(true);
    try {
      const res  = await fetch(`${API_BASE}/api/billing/bills/${sel.id}/send-whatsapp`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_number: waPhone.trim(), include_payment_link: includeLink, save_patient_phone: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        Alert.alert('✅ Sent', `Bill sent to ${waPhone.trim()} on WhatsApp`);
      } else { Alert.alert('Error', data.detail ?? 'Could not send bill'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSending(false); }
  };

  const downloadReceipt = async (b: Bill) => {
    setPdfLoading(b.id);
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
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPdfLoading(null); }
  };

  const renderItem = ({ item: b }: { item: Bill }) => {
    const due   = Math.max(0, (b.total || 0) - (b.paid || 0));
    const color = STATUS_COLOR[b.status] ?? '#64748B';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.billNo}>{b.bill_no}</Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>{STATUS_LABEL[b.status] ?? b.status}</Text>
          </View>
        </View>
        <Text style={styles.patient}>{b.patient_name} <Text style={styles.barcode}>· {b.barcode}</Text></Text>
        {!!b.organization_name && <Text style={styles.org}>🏥 {b.organization_name}</Text>}
        <View style={styles.amtRow}>
          <View><Text style={styles.amtLabel}>Total</Text><Text style={styles.amtVal}>{inr(b.total)}</Text></View>
          <View><Text style={styles.amtLabel}>Paid</Text><Text style={[styles.amtVal, { color: '#10B981' }]}>{inr(b.paid)}</Text></View>
          <View><Text style={styles.amtLabel}>Due</Text><Text style={[styles.amtVal, { color: due > 0 ? '#EF4444' : '#64748B' }]}>{inr(due)}</Text></View>
        </View>
        <Text style={styles.date}>{fmtDateTime(b.created_at)}</Text>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.viewBtn} onPress={() => openBill(b)}>
            <Text style={styles.viewBtnText}>👁  View / Pay</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dlBtn} onPress={() => downloadReceipt(b)} disabled={pdfLoading === b.id}>
            {pdfLoading === b.id ? <ActivityIndicator color="#F97316" size="small" /> : <Text style={styles.dlBtnText}>⬇</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Filters */}
      <View style={styles.filterWrap}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Organization</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowOrgPicker(true)}>
              <Text style={{ color: orgId ? '#F1F5F9' : '#475569', fontSize: 12 }} numberOfLines={1}>
                {orgId ? orgs.find(o => o.id === orgId)?.name ?? 'Selected' : 'All'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>Barcode</Text>
            <TextInput style={styles.input} value={barcode} onChangeText={setBarcode}
              placeholder="barcode" placeholderTextColor="#475569" autoCapitalize="characters" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>From</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowFromPicker(true)}>
              <Text style={{ color: fromDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{fromDate || 'Any'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.fieldLabel}>To</Text>
            <TouchableOpacity style={styles.dateBtn} onPress={() => setShowToPicker(true)}>
              <Text style={{ color: toDate ? '#F1F5F9' : '#475569', fontSize: 12 }}>{toDate || 'Any'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          <TouchableOpacity style={styles.applyBtn} onPress={applyFilters}>
            <Text style={styles.applyBtnText}>Apply Filters</Text>
          </TouchableOpacity>
          {activeFilterCount > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {!loading && <Text style={styles.headerCount}>{bills.length} bill{bills.length !== 1 ? 's' : ''}</Text>}

      {loading ? <ActivityIndicator color="#F97316" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={bills} keyExtractor={b => b.id.toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F97316" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>💳</Text><Text style={styles.emptyText}>No bills found</Text></View>}
        />
      )}

      {/* Organization picker */}
      <Modal visible={showOrgPicker} transparent animationType="slide" onRequestClose={() => setShowOrgPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Organization</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              <TouchableOpacity style={styles.patItem} onPress={() => { setOrgId(null); setShowOrgPicker(false); }}>
                <Text style={{ color: '#475569' }}>All</Text>
              </TouchableOpacity>
              {orgs.map(o => (
                <TouchableOpacity key={o.id} style={[styles.patItem, orgId === o.id && styles.patItemSel]}
                  onPress={() => { setOrgId(o.id); setShowOrgPicker(false); }}>
                  <Text style={styles.patName}>{o.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowOrgPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Bill detail / pay modal */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={closeBill}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {sel && (
              <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View>
                    <Text style={styles.modalTitle}>{sel.bill_no}</Text>
                    <Text style={styles.modalSub}>{sel.patient_name} · {sel.barcode}</Text>
                    {!!sel.organization_name && <Text style={styles.orgLink}>{sel.organization_name}</Text>}
                  </View>
                  <TouchableOpacity onPress={closeBill}><Text style={{ color: '#64748B', fontSize: 18 }}>✕</Text></TouchableOpacity>
                </View>

                <View style={{ marginTop: 14 }}>
                  {sel.items.map((it, i) => (
                    <View key={i} style={styles.itemRow}>
                      <Text style={styles.itemName} numberOfLines={1}>
                        {it.test_name}{it.package_name ? <Text style={styles.itemTag}> ({it.package_name})</Text> : ''}
                      </Text>
                      <Text style={styles.itemPrice}>{inr(it.price)}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.divider} />
                <View style={styles.totalRow}><Text style={styles.totalLbl}>Subtotal</Text><Text style={styles.totalVal}>{inr(sel.subtotal)}</Text></View>
                {sel.discount_amount > 0 && (
                  <View style={styles.totalRow}><Text style={styles.totalLbl}>Discount</Text><Text style={[styles.totalVal, { color: '#EF4444' }]}>– {inr(sel.discount_amount)}</Text></View>
                )}
                <View style={styles.totalRow}><Text style={[styles.totalLbl, { fontWeight: '700', color: '#F1F5F9' }]}>Total</Text><Text style={[styles.totalVal, { fontWeight: '700' }]}>{inr(sel.total)}</Text></View>
                <View style={styles.totalRow}><Text style={styles.totalLbl}>Paid</Text><Text style={[styles.totalVal, { color: '#10B981' }]}>{inr(sel.paid)}</Text></View>
                <View style={styles.totalRow}><Text style={[styles.totalLbl, { fontWeight: '700' }]}>Due</Text><Text style={[styles.totalVal, { color: '#EF4444', fontWeight: '700' }]}>{inr(Math.max(0, sel.total - sel.paid))}</Text></View>

                <Text style={styles.sectionLabel}>Send bill on WhatsApp</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.input, { flex: 1 }]} value={waPhone} onChangeText={setWaPhone}
                    placeholder="10-digit mobile" placeholderTextColor="#475569" keyboardType="phone-pad" />
                  <TouchableOpacity style={styles.sendBtn} onPress={sendWhatsApp} disabled={sending}>
                    {sending ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.sendBtnText}>💬 Send</Text>}
                  </TouchableOpacity>
                </View>
                <View style={styles.checkRow}>
                  <Switch value={includeLink} onValueChange={setIncludeLink}
                    trackColor={{ false: '#334155', true: '#F97316' }} thumbColor="#fff" />
                  <Text style={styles.checkLabel}>Include a payment link (patient can pay online)</Text>
                </View>

                <TouchableOpacity style={styles.receiptBtn} onPress={() => downloadReceipt(sel)} disabled={pdfLoading === sel.id}>
                  {pdfLoading === sel.id ? <ActivityIndicator color="#fff" /> : <Text style={styles.receiptBtnText}>⬇ Download Money Receipt</Text>}
                </TouchableOpacity>
                <View style={{ height: 8 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
  filterWrap:     { padding: 12, paddingBottom: 4 },
  fieldLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6 },
  input:          { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 10, borderRadius: 8, fontSize: 12, borderWidth: 1, borderColor: '#334155' },
  dateBtn:        { backgroundColor: '#1E293B', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  applyBtn:       { flex: 1, backgroundColor: '#F97316', padding: 12, borderRadius: 10, alignItems: 'center' },
  applyBtnText:   { color: '#fff', fontWeight: '700', fontSize: 13 },
  clearBtn:       { paddingHorizontal: 16, justifyContent: 'center' },
  clearBtnText:   { color: '#EF4444', fontSize: 13, fontWeight: '600' },
  headerCount:    { color: '#64748B', fontSize: 12, marginHorizontal: 12, marginBottom: 8, marginTop: 6 },
  card:           { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  cardTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  billNo:         { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:      { fontSize: 10, fontWeight: '700' },
  patient:        { color: '#F1F5F9', fontSize: 13, marginTop: 6 },
  barcode:        { color: '#64748B', fontSize: 12 },
  org:            { color: '#6366F1', fontSize: 11, marginTop: 3 },
  amtRow:         { flexDirection: 'row', gap: 20, marginTop: 10 },
  amtLabel:       { color: '#475569', fontSize: 10 },
  amtVal:         { color: '#F1F5F9', fontSize: 14, fontWeight: '700', marginTop: 2 },
  date:           { color: '#475569', fontSize: 11, marginTop: 8 },
  actionsRow:     { flexDirection: 'row', gap: 8, marginTop: 10 },
  viewBtn:        { flex: 1, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', padding: 10, borderRadius: 8, alignItems: 'center' },
  viewBtnText:    { color: '#0EA5E9', fontSize: 12, fontWeight: '700' },
  dlBtn:          { width: 44, backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#F97316', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dlBtnText:      { color: '#F97316', fontSize: 16, fontWeight: '700' },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  modalSub:       { color: '#64748B', fontSize: 12, marginTop: 3 },
  orgLink:        { color: '#6366F1', fontSize: 12, marginTop: 3, fontWeight: '600' },
  itemRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#0F172A' },
  itemName:       { flex: 1, color: '#F1F5F9', fontSize: 13, marginRight: 8 },
  itemTag:        { color: '#6366F1', fontSize: 11 },
  itemPrice:      { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  divider:        { height: 1, backgroundColor: '#334155', marginVertical: 10 },
  totalRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLbl:       { color: '#64748B', fontSize: 13 },
  totalVal:       { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  sectionLabel:   { color: '#94A3B8', fontSize: 12, fontWeight: '700', marginTop: 18, marginBottom: 8, textTransform: 'uppercase' },
  sendBtn:        { backgroundColor: '#25D366', paddingHorizontal: 16, borderRadius: 8, justifyContent: 'center' },
  sendBtnText:    { color: '#fff', fontWeight: '700', fontSize: 13 },
  checkRow:       { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 },
  checkLabel:     { color: '#94A3B8', fontSize: 12, flex: 1 },
  receiptBtn:     { backgroundColor: '#F97316', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 18 },
  receiptBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  patItem:        { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  patItemSel:     { borderColor: '#F97316', backgroundColor: '#F9731615' },
  patName:        { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  modalCancel:    { marginTop: 12, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
});
