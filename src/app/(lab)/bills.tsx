import { authHeader, API_BASE, getToken, getUser } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import * as Print from 'expo-print';
import bwipjs from '@bwip-js/react-native';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, ScrollView, Alert,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const STATUS_COLOR: Record<string, string> = { unpaid: '#EF4444', partial: '#F59E0B', paid: '#10B981', credit: '#8B5CF6', cancelled: '#64748B' };
// a bill can only be cancelled while every test is still at one of these stages
const CANCELLABLE = ['collected', 'received'];

// ── Sample-label printing (same client-side pattern as New Bill: barcode PNG
// via @bwip-js/react-native embedded as a static <img>, handed to expo-print).
interface LabelItem { patientName: string; testName: string; accession: string; }

async function renderBarcodeDataUri(text: string): Promise<string> {
  const result = await bwipjs.toDataURL({ bcid: 'code128', text, scale: 3, height: 10, includetext: false });
  return result.uri;
}

async function buildLabelsHtml(items: LabelItem[]): Promise<string> {
  const withBarcodes = await Promise.all(items.map(async (it) => ({
    ...it, barcodeUri: await renderBarcodeDataUri(it.accession),
  })));
  const labelBlocks = withBarcodes.map((it) => `
    <div class="label">
      <div class="patient">${escapeHtml(it.patientName)}</div>
      <div class="test">${escapeHtml(it.testName)}</div>
      <img class="barcode" src="${it.barcodeUri}" />
      <div class="code">${escapeHtml(it.accession)}</div>
    </div>
  `).join('');
  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        body { font-family: -apple-system, Helvetica, Arial, sans-serif; margin: 0; padding: 16px; }
        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
        .label {
          text-align: center; padding: 20px 12px; border: 1px dashed #E2E8F0;
          break-inside: avoid; page-break-inside: avoid;
        }
        .patient { font-size: 15px; font-weight: 700; color: #0F172A; margin-bottom: 2px; }
        .test { font-size: 12px; font-weight: 600; color: #17B9A1; margin-bottom: 10px; }
        .barcode { display: block; margin: 0 auto; max-width: 90%; }
        .code { font-size: 11px; color: #0F172A; margin-top: 4px; letter-spacing: 0.5px; }
      </style>
    </head>
    <body>
      <div class="grid">
        ${labelBlocks}
      </div>
    </body>
  </html>`;
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

interface Bill {
  id: number; bill_no: string; patient_name: string; barcode: string;
  total: number; paid: number; status: string; created_at: string;
  organization_name?: string; discount_amount?: number; subtotal?: number;
  collected_by_name?: string | null; branch_name?: string | null;
  items?: any[]; payments?: any[]; phone?: string | null;
  cancel_reason?: string | null; cancelled_at?: string | null;
}

export default function Bills() {
  const isFranchise = getUser()?.role === 'franchise';
  const isAdmin = ['lab_admin', 'super_admin'].includes(getUser()?.role ?? '');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [bills, setBills]       = useState<Bill[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]     = useState('');
  const [showAccSearch, setShowAccSearch] = useState(false);
  const [accessionQuery, setAccessionQuery] = useState('');
  const [accessionSearching, setAccessionSearching] = useState(false);
  const [filter, setFilter]     = useState('all');

  // Detail modal
  const [sel, setSel]           = useState<Bill | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editValue, setEditValue]         = useState('');
  const [savingAccession, setSavingAccession] = useState(false);
  const [payingMethod, setPayingMethod]   = useState<string | null>(null);
  const [waPhone, setWaPhone]   = useState('');
  const [waBusy, setWaBusy]     = useState(false);
  const [waiting, setWaiting]   = useState(false);
  const [printing, setPrinting] = useState(false);
  const [cancelOpen, setCancelOpen]     = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy]     = useState(false);

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
    setCancelOpen(false); setCancelReason('');
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${b.id}`, { headers: authHeader() });
      if (res.ok) { const full = await res.json(); setSel(full); }
    } catch {} finally { setDetailLoading(false); }
  };

  // Jump straight to the bill a specific accession number belongs to
  const searchByAccession = async () => {
    const code = accessionQuery.trim().toUpperCase();
    if (!code) return;
    setAccessionSearching(true);
    try {
      const res = await fetch(`${API_BASE}/api/sample-status/search?accession_number=${encodeURIComponent(code)}`, { headers: authHeader() });
      const data = await res.json().catch(() => []);
      const match = Array.isArray(data) ? data[0] : null;
      if (!match) { Alert.alert('Not found', `No test found with accession number "${code}"`); return; }
      await openBill({ id: match.bill_id } as Bill);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setAccessionSearching(false);
    }
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

  const cancelBill = async () => {
    if (!sel) return;
    const reason = cancelReason.trim();
    if (!reason) { Alert.alert('Reason needed', 'Enter a reason for cancelling this bill'); return; }
    setCancelBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${sel.id}/cancel`, {
        method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail ?? 'Cancel failed'); }
      const updated = await res.json();
      setSel(updated); setCancelOpen(false); setCancelReason(''); fetchBills();
      const refunded = Math.abs((updated.payments ?? [])
        .filter((p: any) => (Number(p.amount) || 0) < 0)
        .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0));
      Alert.alert('Bill cancelled',
        refunded > 0 ? `${updated.bill_no} cancelled · ${inr(refunded)} refunded` : `${updated.bill_no} cancelled`);
    } catch (e: any) { Alert.alert('Could not cancel', e.message); }
    finally { setCancelBusy(false); }
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
    setEditingItemId(null); setEditValue('');
  };

  // Once a sample is received (or later) only a lab admin may renumber it — the
  // server enforces this too (and also locks it once a result exists).
  const accLocked = (it: any) => !isAdmin && (it.status ?? 'collected') !== 'collected';

  const startEditAccession = (it: any) => {
    if (accLocked(it)) { Alert.alert('Locked', 'Accession number is locked — the sample is already received or has a result. Ask a lab admin to change it.'); return; }
    setEditingItemId(it.id);
    setEditValue(it.accession_number ?? '');
  };

  const saveAccession = async (it: any) => {
    const code = editValue.trim().toUpperCase();
    if (!code) { Alert.alert('Error', 'Accession number cannot be empty'); return; }

    // Duplicate check against every other test on this bill
    const clash = sel?.items?.find(x => x.id !== it.id && (x.accession_number ?? '').toUpperCase() === code);
    if (clash) {
      Alert.alert('Duplicate accession number', `Accession number '${code}' is already in use by another test`);
      return;
    }

    setSavingAccession(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${sel!.id}/items/${it.id}/accession`, {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ accession_number: code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? 'Could not update accession number');
      setSel(data); // endpoint returns the full updated bill
      setEditingItemId(null);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSavingAccession(false);
    }
  };

  // Print a single sample's barcode label
  const printOneSample = async (accession: string, testName: string) => {
    if (!accession) { Alert.alert('No accession number', `Enter an accession number for ${testName} before printing.`); return; }
    setPrinting(true);
    try {
      const html = await buildLabelsHtml([{ patientName: sel?.patient_name ?? 'Patient', testName, accession }]);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print failed', e.message ?? 'Could not generate the barcode label');
    } finally { setPrinting(false); }
  };

  // Print every sample label on this bill in one go
  const printAllSamples = async () => {
    const items: LabelItem[] = (sel?.items ?? [])
      .filter((it: any) => it.accession_number)
      .map((it: any) => ({
        patientName: sel?.patient_name ?? 'Patient',
        testName: it.test_name,
        accession: it.accession_number,
      }));
    if (items.length === 0) { Alert.alert('Nothing to print', 'No accession numbers found on this bill.'); return; }
    setPrinting(true);
    try {
      const html = await buildLabelsHtml(items);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print failed', e.message ?? 'Could not generate the barcode labels');
    } finally { setPrinting(false); }
  };

  const renderItem = ({ item: b }: { item: Bill }) => {
    const color        = STATUS_COLOR[b.status] ?? '#64748B';
    const rowCancelled = b.status === 'cancelled';
    // a cancelled bill owes nothing — it stays on record but is not outstanding
    const balance      = rowCancelled ? 0 : b.total - b.paid;
    return (
      <TouchableOpacity style={[styles.card, rowCancelled && styles.cardCancelled]} onPress={() => openBill(b)}>
        <View style={styles.cardRow}>
          <Text style={[styles.billNo, rowCancelled && styles.billNoCancelled]}>🧾 {b.bill_no}</Text>
          <View style={[styles.badge, { borderColor: color }]}>
            <Text style={[styles.badgeText, { color }]}>● {b.status}</Text>
          </View>
        </View>
        <Text style={styles.patName}>{b.patient_name}</Text>
        <Text style={styles.barcode}>{b.barcode}</Text>
        {!!(b.collected_by_name || b.branch_name) && (
          <Text style={styles.collectedBy}>
            🧑‍🔬 {b.collected_by_name || '—'}{b.branch_name ? `  ·  ${b.branch_name}` : ''}
          </Text>
        )}
        <View style={styles.amtRow}>
          <View><Text style={styles.amtLabel}>Total</Text><Text style={styles.amtVal}>{inr(b.total)}</Text></View>
          <View><Text style={styles.amtLabel}>Paid</Text><Text style={[styles.amtVal, { color: '#10B981' }]}>{inr(b.paid)}</Text></View>
          <View><Text style={styles.amtLabel}>Balance</Text><Text style={[styles.amtVal, { color: balance > 0 ? '#EF4444' : '#10B981' }]}>{inr(balance)}</Text></View>
        </View>
        <Text style={styles.date}>🕐 {new Date(b.created_at).toLocaleString('en-IN')}  ·  Tap for details ›</Text>
      </TouchableOpacity>
    );
  };

  const isCancelled = sel?.status === 'cancelled';
  const due    = (sel && !isCancelled) ? Math.max(0, (sel.total || 0) - (sel.paid || 0)) : 0;
  const isPaid = sel && due <= 0;
  const isCredit = sel?.status === 'credit';
  // tests that have already moved past 'received' — these block cancellation
  const blockingItems = (sel?.items ?? []).filter((it: any) => !CANCELLABLE.includes(it.status ?? 'collected'));
  const refundedAmt = Math.abs((sel?.payments ?? [])
    .filter((p: any) => (Number(p.amount) || 0) < 0)
    .reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0));

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="🔍  Search bills..." placeholderTextColor="#475569" />
      </View>

      <TouchableOpacity style={styles.accToggleRow} onPress={() => setShowAccSearch(v => !v)}>
        <Text style={styles.accToggleText}>🔬  Search by Accession No.</Text>
        <Text style={styles.accToggleChevron}>{showAccSearch ? '▲' : '▼'}</Text>
      </TouchableOpacity>
      {showAccSearch && (
        <View style={styles.accSearchBox}>
          <TextInput style={[styles.search, { flex: 1 }]} value={accessionQuery} onChangeText={setAccessionQuery}
            placeholder="e.g. HC24734B" placeholderTextColor="#475569" autoCapitalize="characters"
            onSubmitEditing={searchByAccession} />
          <TouchableOpacity style={styles.accSearchBtn} onPress={searchByAccession} disabled={accessionSearching}>
            {accessionSearching ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.accSearchBtnText}>Find</Text>}
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.filterRow}>
        {['all','unpaid','partial','paid','credit'].map(f => (
          <TouchableOpacity key={f} style={[styles.filterBtn, filter === f && styles.filterBtnActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && { color: '#fff' }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.count}>{filtered.length} bill{filtered.length !== 1 ? 's' : ''}</Text>
      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={filtered} keyExtractor={(b, i) => (b.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}
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

            {sel?.items && sel.items.some((it: any) => it.accession_number) && (
              <TouchableOpacity style={styles.printAllBtn} onPress={printAllSamples} disabled={printing}>
                {printing ? <ActivityIndicator color="#17B9A1" size="small" /> : <Text style={styles.printAllBtnText}>🖨  Print All Samples</Text>}
              </TouchableOpacity>
            )}

            {detailLoading ? <ActivityIndicator color="#17B9A1" style={{ marginVertical: 24 }} /> : (
              <ScrollView style={{ maxHeight: 460 }}>
                {/* Cancelled banner */}
                {isCancelled && (
                  <View style={styles.cancelledBox}>
                    <Text style={styles.cancelledTitle}>This bill was cancelled</Text>
                    <Text style={styles.cancelledSub}>
                      {sel?.cancel_reason || '—'}
                      {sel?.cancelled_at ? `  ·  ${new Date(sel.cancelled_at).toLocaleString('en-IN')}` : ''}
                    </Text>
                    {refundedAmt > 0 && <Text style={styles.cancelledRefund}>{inr(refundedAmt)} refunded</Text>}
                  </View>
                )}

                {/* Items */}
                {sel?.items && sel.items.length > 0 && (
                  <View style={styles.itemsBox}>
                    {sel.items.map((it, i) => (
                      <View key={i} style={styles.itemRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemName}>
                            {it.test_name}{it.package_name ? <Text style={styles.itemPkg}>  ·  {it.package_name}</Text> : null}
                          </Text>
                          {editingItemId === it.id ? (
                            <View style={styles.accEditRow}>
                              <TextInput
                                style={styles.accEditInput}
                                value={editValue}
                                onChangeText={setEditValue}
                                autoCapitalize="characters"
                                autoFocus
                                editable={!savingAccession}
                              />
                              <TouchableOpacity style={styles.accSaveBtn} onPress={() => saveAccession(it)} disabled={savingAccession}>
                                {savingAccession ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.accSaveBtnText}>✓</Text>}
                              </TouchableOpacity>
                            </View>
                          ) : it.accession_number ? (
                            <View style={styles.accRow}>
                              <TouchableOpacity onPress={() => startEditAccession(it)}>
                                <View style={styles.accBadge}>
                                  <Text style={styles.accBadgeText}>{it.accession_number}{accLocked(it) ? '  🔒' : ''}</Text>
                                </View>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.printOneBtn} onPress={() => printOneSample(it.accession_number, it.test_name)} disabled={printing}>
                                <Text style={styles.printOneBtnIcon}>🖨</Text>
                              </TouchableOpacity>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.itemPrice}>{inr(it.price)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Totals */}
                <View style={styles.totalsBox}>
                  {sel?.subtotal != null && <View style={styles.tRow}><Text style={styles.tLabel}>Subtotal</Text><Text style={styles.tVal}>{inr(sel.subtotal)}</Text></View>}
                  {(sel?.discount_amount ?? 0) > 0 && <View style={styles.tRow}><Text style={styles.tLabel}>Discount</Text><Text style={[styles.tVal, { color: '#EF4444' }]}>– {inr(sel!.discount_amount!)}</Text></View>}
                  <View style={styles.tRow}><Text style={[styles.tLabel, { fontWeight: 'bold', color: '#0F172A' }]}>Total</Text><Text style={[styles.tVal, { fontWeight: 'bold', fontSize: 16 }]}>{inr(sel?.total ?? 0)}</Text></View>
                  <View style={styles.tRow}><Text style={styles.tLabel}>Paid</Text><Text style={[styles.tVal, { color: '#10B981' }]}>{inr(sel?.paid ?? 0)}</Text></View>
                  <View style={styles.tRow}><Text style={[styles.tLabel, { fontWeight: 'bold' }]}>Due</Text><Text style={[styles.tVal, { color: due > 0 ? '#EF4444' : '#10B981', fontWeight: 'bold' }]}>{inr(due)}</Text></View>
                </View>

                {/* Payments history */}
                {sel?.payments && sel.payments.length > 0 && (
                  <Text style={styles.payHist}>Payments: {sel.payments.map((p: any) => `${p.method ?? 'online'} ${inr(p.amount)}`).join(', ')}</Text>
                )}

                {/* ── UNPAID: payment options (lab only, not credit, not cancelled) ── */}
                {!isFranchise && !isPaid && !isCredit && !isCancelled && (
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
                {isCredit && !isCancelled && (
                  <View style={styles.creditBox}>
                    <Text style={styles.creditText}>On credit — settle from Manage Credit / organization ledger.</Text>
                  </View>
                )}

                {/* Receipt actions — always */}
                <View style={styles.receiptRow}>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#F97316', flex: 1 }]} onPress={() => sel && receipt(sel)}>
                    <Text style={styles.payBtnText}>⬇ Download Receipt</Text>
                  </TouchableOpacity>
                  {!isCancelled && (
                    <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#25D366', flex: 1 }]} onPress={sendWhatsApp}>
                      <Text style={styles.payBtnText}>💬 Send Receipt</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* ── CANCEL BILL — admin only, allowed up to and including 'received' ── */}
                {isAdmin && !isCancelled && (
                  blockingItems.length > 0 ? (
                    <View style={styles.cantCancelBox}>
                      <Text style={styles.cantCancelTitle}>This bill can no longer be cancelled</Text>
                      <Text style={styles.cantCancelSub}>
                        Work has already started on {blockingItems.length === 1 ? 'this test' : 'these tests'}:{' '}
                        {blockingItems.slice(0, 4).map((it: any) =>
                          `${it.package_name ? `${it.package_name} (${it.test_name})` : it.test_name} — ${it.status}`).join('; ')}
                        {blockingItems.length > 4 ? ` and ${blockingItems.length - 4} more` : ''}.
                      </Text>
                    </View>
                  ) : !cancelOpen ? (
                    <TouchableOpacity style={styles.cancelOpenBtn} onPress={() => setCancelOpen(true)}>
                      <Text style={styles.cancelOpenBtnText}>Cancel this bill</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.cancelSection}>
                      <Text style={styles.payLabel}>REASON FOR CANCELLING (REQUIRED)</Text>
                      <TextInput
                        style={styles.waInput}
                        value={cancelReason}
                        onChangeText={setCancelReason}
                        placeholder="e.g. duplicate bill — same tests already billed"
                        placeholderTextColor="#475569"
                        editable={!cancelBusy}
                        autoFocus
                      />
                      {(sel?.paid ?? 0) > 0 && (
                        <View style={styles.refundWarnBox}>
                          <Text style={styles.refundWarnText}>
                            {inr(sel?.paid ?? 0)} has been collected on this bill. Cancelling records a refund of {inr(sel?.paid ?? 0)} and sets the bill to ₹0 — hand the money back at the counter.
                          </Text>
                        </View>
                      )}
                      <Text style={styles.cancelNote}>
                        The bill stays on record as cancelled — it is not deleted, and {sel?.bill_no} is not reused.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#DC2626', flex: 1 }]}
                          onPress={cancelBill} disabled={cancelBusy}>
                          {cancelBusy ? <ActivityIndicator color="#fff" size="small" /> : (
                            <Text style={styles.payBtnText}>
                              {(sel?.paid ?? 0) > 0 ? `Confirm cancel & refund ${inr(sel?.paid ?? 0)}` : 'Confirm cancel'}
                            </Text>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.keepBillBtn}
                          onPress={() => { setCancelOpen(false); setCancelReason(''); }} disabled={cancelBusy}>
                          <Text style={styles.keepBillBtnText}>Keep bill</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#F8FAFC' },
  searchWrap:      { padding: 12, paddingBottom: 0 },
  search:          { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  accToggleRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 10 },
  accToggleText:   { color: '#6366f1', fontSize: 12.5, fontWeight: '700' },
  accToggleChevron:{ color: '#6366f1', fontSize: 11, fontWeight: '700' },
  accSearchBox:    { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  accSearchBtn:    { backgroundColor: '#17B9A1', paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  accSearchBtnText:{ color: '#fff', fontWeight: '700', fontSize: 13 },
  filterRow:       { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 6, flexWrap: 'wrap' },
  filterBtn:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  filterBtnActive: { backgroundColor: '#17B9A1', borderColor: '#17B9A1' },
  filterText:      { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  count:           { color: '#475569', fontSize: 12, paddingHorizontal: 12, marginBottom: 4 },
  card:            { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  cardCancelled:   { opacity: 0.55 },
  cardRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  billNo:          { color: '#0F172A', fontSize: 14, fontWeight: 'bold' },
  collectedBy:     { color: '#0D9488', fontSize: 11, marginTop: 2 },
  billNoCancelled: { textDecorationLine: 'line-through', color: '#64748B' },
  cancelledBox:    { backgroundColor: '#64748B14', borderRadius: 8, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: '#64748B40' },
  cancelledTitle:  { color: '#475569', fontSize: 13.5, fontWeight: '800' },
  cancelledSub:    { color: '#64748B', fontSize: 12, marginTop: 3 },
  cancelledRefund: { color: '#B91C1C', fontSize: 12.5, fontWeight: '700', marginTop: 4 },
  cantCancelBox:   { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  cantCancelTitle: { color: '#475569', fontSize: 12.5, fontWeight: '700' },
  cantCancelSub:   { color: '#64748B', fontSize: 11.5, marginTop: 3, lineHeight: 17 },
  cancelOpenBtn:   { marginTop: 10, borderWidth: 1, borderColor: '#DC262655', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  cancelOpenBtnText:{ color: '#DC2626', fontSize: 13.5, fontWeight: '700' },
  cancelSection:   { marginTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingTop: 12 },
  cancelNote:      { color: '#64748B', fontSize: 11.5, marginTop: 6, marginBottom: 10, lineHeight: 17 },
  refundWarnBox:   { backgroundColor: '#DC26260F', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#DC262633' },
  refundWarnText:  { color: '#B91C1C', fontSize: 12, lineHeight: 18 },
  keepBillBtn:     { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  keepBillBtnText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  badge:           { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:       { fontSize: 11, fontWeight: '700' },
  patName:         { color: '#0F172A', fontSize: 15, fontWeight: '600', marginBottom: 2 },
  barcode:         { color: '#64748B', fontSize: 12, marginBottom: 6 },
  amtRow:          { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginVertical: 8 },
  amtLabel:        { color: '#64748B', fontSize: 11, marginBottom: 2 },
  amtVal:          { color: '#0F172A', fontSize: 15, fontWeight: 'bold' },
  date:            { color: '#475569', fontSize: 11 },
  empty:           { alignItems: 'center', marginTop: 60 },
  emptyIcon:       { fontSize: 48 },
  emptyText:       { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:        { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  modalHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalBillNo:     { color: '#0F172A', fontSize: 20, fontWeight: 'bold' },
  modalSub:        { color: '#94A3B8', fontSize: 13, marginTop: 2 },
  modalOrg:        { color: '#6366f1', fontSize: 12, marginTop: 2 },
  closeX:          { color: '#64748B', fontSize: 22, padding: 4 },
  printAllBtn:     { alignSelf: 'flex-start', backgroundColor: '#17B9A115', borderWidth: 1, borderColor: '#17B9A155', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12 },
  printAllBtnText: { color: '#17B9A1', fontSize: 11, fontWeight: '700' },
  printOneBtn:     { width: 26, height: 26, borderRadius: 6, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  printOneBtnIcon: { fontSize: 12 },
  accRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemsBox:        { backgroundColor: '#F8FAFC', borderRadius: 8, padding: 10, marginBottom: 10 },
  itemRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 6 },
  itemName:        { color: '#0F172A', fontSize: 13, fontWeight: '500' },
  itemPkg:         { color: '#94A3B8', fontSize: 11 },
  itemPrice:       { color: '#0F172A', fontSize: 13, fontWeight: '600', marginLeft: 10 },
  accBadge:        { alignSelf: 'flex-start', backgroundColor: '#F97316', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, marginTop: 3 },
  accBadgeText:    { color: '#fff', fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
  accEditRow:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  accEditInput:    { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, fontSize: 11, fontWeight: '700', borderWidth: 1.5, borderColor: '#17B9A1', minWidth: 100 },
  accSaveBtn:      { backgroundColor: '#10B981', width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  accSaveBtnText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  totalsBox:       { marginBottom: 10 },
  tRow:            { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  tLabel:          { color: '#64748B', fontSize: 13 },
  tVal:            { color: '#0F172A', fontSize: 13 },
  payHist:         { color: '#475569', fontSize: 11, marginBottom: 10, fontStyle: 'italic' },
  paySection:      { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  payLabel:        { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  payBtn:          { flex: 1, padding: 11, borderRadius: 10, alignItems: 'center' },
  payBtnText:      { color: '#fff', fontWeight: '700', fontSize: 12 },
  waInput:         { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 11, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0' },
  waBtn:           { backgroundColor: '#25D366', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  waBtnText:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  waitBox:         { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10 },
  waitText:        { color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
  creditBox:       { backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#8B5CF633' },
  creditText:      { color: '#8B5CF6', fontSize: 13 },
  receiptRow:      { flexDirection: 'row', gap: 8, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
});
