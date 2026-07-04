import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Alert, Switch, Linking,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { authHeader, API_BASE, getUser, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Patient   { id: number; barcode: string; patient_name: string; organization_id: number | null; phone: string | null; }
interface Test      { id: number; name: string; price: number; mrp: number; sample_type: string; }
interface TestGroup { id: number; name: string; price: number; tests: { id: number; name: string }[]; test_ids?: number[]; }
interface Org       { id: number; name: string; }

export default function NewBill() {
  const currentUser   = getUser();
  const isFranchise   = currentUser?.role === 'franchise';
  const allowDiscount = !isFranchise;
  const rawParams     = useLocalSearchParams();
  const patientIdParam = rawParams?.patient_id ? String(rawParams.patient_id) : null;
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const [patients, setPatients]   = useState<Patient[]>([]);
  const [tests, setTests]         = useState<Test[]>([]);
  const [groups, setGroups]       = useState<TestGroup[]>([]);
  const [orgs, setOrgs]           = useState<Org[]>([]);
  const [loading, setLoading]     = useState(true);

  const [patientId, setPatientId]       = useState<number | null>(null);
  const [pickedTests, setPickedTests]   = useState<Record<number,{name:string;price:number}>>({});
  const [pickedGroups, setPickedGroups] = useState<Record<number,TestGroup>>({});
  const [discType, setDiscType]         = useState<''|'flat'|'percent'>('');
  const [discVal, setDiscVal]           = useState('');
  const [onCredit, setOnCredit]         = useState(isFranchise);
  const [saving, setSaving]             = useState(false);
  const [lastBill, setLastBill]         = useState<any>(null);
  const [waPhone, setWaPhone]           = useState('');
  const [waBusy, setWaBusy]             = useState(false);
  const [payingMethod, setPayingMethod] = useState<string|null>(null);
  const [waiting, setWaiting]           = useState(false); // polling for payment

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showDiscPicker, setShowDiscPicker]     = useState(false);
  const [patientSearch, setPatientSearch]       = useState('');
  const [testSearch, setTestSearch]             = useState('');

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Load master data — runs on every focus, not just first mount, so a
  // patient registered on another screen (e.g. via Register & Bill) shows up
  // immediately instead of requiring an app restart. Subsequent refetches are
  // silent (loading stays false) so the screen doesn't flash a spinner every
  // time the user navigates back to it.
  const loadData = useCallback(async () => {
    try {
      const h = authHeader();
      const [p, t, g, o] = await Promise.all([
        fetch(`${API_BASE}/api/patients/`,         { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/tests`,          { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/test-groups`,    { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/organizations`,  { headers: h }).then(r => r.ok ? r.json() : []),
      ]);
      setPatients(Array.isArray(p) ? p : []);
      setTests(Array.isArray(t) ? t : []);
      setGroups(Array.isArray(g) ? g : []);
      setOrgs(Array.isArray(o) ? o : []);
    } catch {
      // silent — keep whatever was already loaded
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Apply patient_id from the route params whenever it's present — covers
  // navigating here again with a different pre-selected patient (e.g. after
  // registering a new patient and tapping "Register & Bill" a second time).
  useEffect(() => {
    if (patientIdParam) {
      const pid = parseInt(patientIdParam);
      if (!isNaN(pid)) setPatientId(pid);
    }
  }, [patientIdParam]);

  const patient  = patients.find(p => p.id === patientId) ?? null;
  const orgId    = patient?.organization_id ?? null;
  const orgName  = orgs.find(o => o.id === orgId)?.name ?? 'Direct / Walk-in';

  const groupMemberIds = new Set(
    Object.values(pickedGroups).flatMap(g => (g.test_ids ?? g.tests.map(t => t.id)))
  );
  const groupSubtotal = Object.values(pickedGroups).reduce((s, g) => s + (g.price || 0), 0);
  const testSubtotal  = Object.values(pickedTests).reduce((s, t) => s + (t.price || 0), 0);
  const subtotal      = groupSubtotal + testSubtotal;

  const discAmount = (() => {
    if (!allowDiscount || !discType || !discVal) return 0;
    const v = Number(discVal) || 0;
    if (discType === 'flat')    return Math.min(v, subtotal);
    if (discType === 'percent') return Math.round(subtotal * (v / 100) * 100) / 100;
    return 0;
  })();
  const total = Math.max(0, subtotal - discAmount);

  const toggleGroup = (g: TestGroup) => {
    if (pickedGroups[g.id]) {
      setPickedGroups(prev => { const n = {...prev}; delete n[g.id]; return n; });
    } else {
      setPickedGroups(prev => ({ ...prev, [g.id]: g }));
      const ids = g.test_ids ?? g.tests.map(t => t.id);
      setPickedTests(prev => { const n = {...prev}; ids.forEach(id => delete n[id]); return n; });
    }
  };

  const toggleTest = (t: Test) => {
    if (groupMemberIds.has(t.id)) { Alert.alert('In group', `${t.name} is already in a selected group`); return; }
    if (pickedTests[t.id]) {
      setPickedTests(prev => { const n = {...prev}; delete n[t.id]; return n; });
    } else {
      setPickedTests(prev => ({ ...prev, [t.id]: { name: t.name, price: t.price } }));
    }
  };

  // Refresh bill from API
  const refreshBill = useCallback(async (id: number) => {
    try {
      const tok = getToken();
      if (!tok) return null;
      const res = await fetch(`${API_BASE}/api/billing/bills/${id}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) { const b = await res.json(); setLastBill(b); return b; }
    } catch {}
    return null;
  }, []);

  // Download receipt PDF WITH auth token, then open share sheet
  const openReceipt = useCallback(async (billId: number, billNo: string) => {
    try {
      const token   = getToken();
      const fileUri = FileSystem.cacheDirectory + `Receipt_${billNo}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/billing/bills/${billId}/receipt`,
        fileUri,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Could not fetch receipt'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Receipt ${billNo}` });
      } else {
        Alert.alert('Saved', `Receipt saved: ${dl.uri}`);
      }
    } catch (e: any) {
      Alert.alert('Error', 'Receipt failed: ' + e.message);
    }
  }, []);

  // Poll payment status
  const startPolling = useCallback((plinkId: string, billId: number) => {
    setWaiting(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const tok = getToken();
        if (!tok) return; // no token yet, skip this tick
        const res = await fetch(`${API_BASE}/api/billing/payment-link/${plinkId}/status`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!res.ok) return;
        const st = await res.json();
        if (st && st.paid) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setWaiting(false);
          const updated = await refreshBill(billId);
          Alert.alert('✅ Payment received!', updated ? `${inr(updated.total)} received` : 'Payment confirmed');
        }
      } catch (e) {
        // network hiccup — keep polling silently
      }
    }, 4000);
  }, [refreshBill]);

  const stopWaiting = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setWaiting(false);
  };

  // Cash / UPI
  const payCashUpi = async (method: 'cash' | 'upi') => {
    if (!lastBill) return;
    const due = Math.max(0, (lastBill.total || 0) - (lastBill.paid || 0));
    setPayingMethod(method);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${lastBill.id}/payments`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, amount: due }),
      });
      if (!res.ok) throw new Error('Payment failed');
      const updated = await res.json();
      setLastBill(updated);
      Alert.alert('✅ Paid', `${inr(due)} recorded (${method.toUpperCase()})`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPayingMethod(null); }
  };

  // Razorpay — create payment link → open in browser → poll for completion
  const payRazorpay = async () => {
    if (!lastBill) return;
    setPayingMethod('razorpay');
    try {
      const tok = getToken();
      const res = await fetch(`${API_BASE}/api/billing/bills/${lastBill.id}/payment-link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.detail ?? 'Could not create payment link');
      }
      const data = await res.json();
      // Response: { id (=plink_id), short_url, amount, bill_no }
      if (data.short_url) {
        // Start polling BEFORE opening browser so we catch the payment
        if (data.id) startPolling(data.id, lastBill.id);  // 'id' is the plink_id
        // Open in in-app browser (keeps app alive → no logout, polling continues)
        await WebBrowser.openBrowserAsync(data.short_url);
        // When user closes the in-app browser, polling is still running
      } else {
        throw new Error('No payment URL returned');
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPayingMethod(null); }
  };

  // WhatsApp — send bill link → poll
  const sendWhatsApp = async () => {
    if (!lastBill || !waPhone.trim()) { Alert.alert('Error', 'Enter WhatsApp number'); return; }
    setWaBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${lastBill.id}/send-whatsapp`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_number: waPhone.trim(), include_payment_link: true, save_patient_phone: true }),
      });
      if (!res.ok) throw new Error('WhatsApp send failed');
      const out = await res.json();
      Alert.alert('✅ Sent!', `Payment link sent to ${waPhone.trim()}`);
      if (out.plink_id) startPolling(out.plink_id, lastBill.id);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setWaBusy(false); }
  };

  // Generate bill
  const generate = async () => {
    if (!patientId) { Alert.alert('Error', 'Select a patient'); return; }
    const hasItems = Object.keys(pickedTests).length > 0 || Object.keys(pickedGroups).length > 0;
    if (!hasItems) { Alert.alert('Error', 'Add at least one test'); return; }
    setSaving(true);
    try {
      const payload = {
        patient_id: patientId,
        organization_id: orgId,
        test_ids:  Object.keys(pickedTests).map(Number),
        group_ids: Object.keys(pickedGroups).map(Number),
        discount_type:  allowDiscount ? (discType || null) : null,
        discount_value: allowDiscount ? (Number(discVal) || 0) : 0,
        on_credit: isFranchise ? !!orgId : (onCredit && !!orgId),
      };
      const res = await fetch(`${API_BASE}/api/billing/bills`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? JSON.stringify(data));
      setLastBill(data);
      setPickedTests({}); setPickedGroups({}); setDiscType(''); setDiscVal('');
      setWaPhone(patient?.phone ?? '');
      Alert.alert('✅ Bill Created', `${data.bill_no}  ·  ${inr(data.total)}`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const resetForm = () => {
    setPatientId(null); setPickedTests({}); setPickedGroups({});
    setDiscType(''); setDiscVal(''); setOnCredit(isFranchise);
    setLastBill(null); setWaPhone(''); stopWaiting();
  };

  const filteredPats   = patients.filter(p =>
    p.patient_name.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.barcode.toLowerCase().includes(patientSearch.toLowerCase())
  );
  const filteredGroups = groups.filter(g => !testSearch || g.name.toLowerCase().includes(testSearch.toLowerCase()));
  const filteredTests  = tests.filter(t => !testSearch || t.name.toLowerCase().includes(testSearch.toLowerCase()));
  const hasItems = Object.keys(pickedTests).length > 0 || Object.keys(pickedGroups).length > 0;
  const due    = lastBill ? Math.max(0, (lastBill.total || 0) - (lastBill.paid || 0)) : 0;
  const isPaid = lastBill && due <= 0;

  if (loading) return (
    <View style={styles.loading}>
      <ActivityIndicator color="#0EA5E9" size="large" />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">

      {/* PATIENT */}
      <View style={styles.section}>
        <Text style={styles.sLabel}>PATIENT</Text>
        <TouchableOpacity style={styles.selector} onPress={() => setShowPatientModal(true)}>
          <Text style={patient ? styles.selVal : styles.selPh} numberOfLines={1}>
            {patient ? `${patient.patient_name}  ·  ${patient.barcode}` : 'Select patient...'}
          </Text>
          <Text style={styles.arrow}>▾</Text>
        </TouchableOpacity>
        {patient && (
          <Text style={[styles.billingTo, { color: orgId ? '#6366f1' : '#64748B' }]}>
            {orgId ? '🏥' : '🚶'} Billing to: {orgName}
          </Text>
        )}
      </View>

      {/* TESTS */}
      {patientId && (
        <>
          <View style={styles.section}>
            <Text style={styles.sLabel}>ADD TESTS</Text>
            <TextInput style={styles.searchInput} value={testSearch} onChangeText={setTestSearch}
              placeholder="🔍  Search tests or groups..." placeholderTextColor="#475569" />
            {filteredGroups.length > 0 && <>
              <Text style={styles.subLabel}>TEST GROUPS</Text>
              {filteredGroups.map(g => {
                const sel = !!pickedGroups[g.id];
                return (
                  <TouchableOpacity key={g.id} style={[styles.testItem, sel && styles.testItemSel]} onPress={() => toggleGroup(g)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.testName}>{g.name}</Text>
                      <Text style={styles.testSub}>{g.tests.map(t => t.name).join(' · ')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.testPrice}>{inr(g.price)}</Text>
                      {sel && <Text style={styles.addedBadge}>✓ added</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>}
            {filteredTests.length > 0 && <>
              <Text style={[styles.subLabel, { marginTop: 10 }]}>INDIVIDUAL TESTS</Text>
              {filteredTests.map(t => {
                const sel = !!pickedTests[t.id]; const inGrp = groupMemberIds.has(t.id);
                return (
                  <TouchableOpacity key={t.id}
                    style={[styles.testItem, sel && styles.testItemSel, inGrp && { opacity: 0.45 }]}
                    onPress={() => toggleTest(t)} disabled={inGrp}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.testName}>{t.name}</Text>
                      <Text style={styles.testSub}>{t.sample_type}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.testPrice}>{inr(t.price)}</Text>
                      {inGrp && <Text style={styles.inGrpBadge}>in group</Text>}
                      {sel && !inGrp && <Text style={styles.addedBadge}>✓ added</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>}
          </View>

          {/* BILL SUMMARY */}
          {hasItems && (
            <View style={styles.section}>
              <Text style={styles.sLabel}>BILL ITEMS</Text>
              <View style={styles.billCard}>
                {Object.entries(pickedGroups).map(([gid, g]) => (
                  <View key={gid} style={styles.billRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billName}>{g.name} <Text style={styles.grpTag}>GROUP</Text></Text>
                      <Text style={styles.billSub}>{g.tests.map(t => t.name).join(' · ')}</Text>
                    </View>
                    <Text style={styles.billPrice}>{inr(g.price)}</Text>
                  </View>
                ))}
                {Object.entries(pickedTests).map(([tid, t]) => (
                  <View key={tid} style={styles.billRow}>
                    <Text style={[styles.billName, { flex: 1 }]}>{t.name}</Text>
                    <Text style={styles.billPrice}>{inr(t.price)}</Text>
                  </View>
                ))}
                <View style={styles.divider} />

                {/* Discount — lab admin only */}
                {allowDiscount && (
                  <View style={{ marginBottom: 10 }}>
                    <Text style={styles.discLabel}>DISCOUNT (Admin only)</Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={styles.discTypePicker} onPress={() => setShowDiscPicker(true)}>
                        <Text style={styles.discTypeText}>
                          {discType === 'flat' ? 'Flat ₹' : discType === 'percent' ? 'Percent %' : 'No discount'}
                        </Text>
                        <Text style={{ color: '#64748B' }}>▾</Text>
                      </TouchableOpacity>
                      {discType !== '' && (
                        <TextInput style={styles.discInput} value={discVal} onChangeText={setDiscVal}
                          keyboardType="numeric" placeholder={discType === 'percent' ? '%' : '₹'} placeholderTextColor="#475569" />
                      )}
                    </View>
                  </View>
                )}

                {/* Totals */}
                <View style={styles.totalRow}><Text style={styles.totalLbl}>Subtotal</Text><Text style={styles.totalVal}>{inr(subtotal)}</Text></View>
                {discAmount > 0 && <View style={styles.totalRow}><Text style={styles.totalLbl}>Discount</Text><Text style={[styles.totalVal, { color: '#EF4444' }]}>– {inr(discAmount)}</Text></View>}
                <View style={[styles.totalRow, { marginTop: 4 }]}>
                  <Text style={[styles.totalLbl, { fontSize: 16, color: '#F1F5F9', fontWeight: 'bold' }]}>Total</Text>
                  <Text style={[styles.totalVal, { fontSize: 20, color: '#10B981' }]}>{inr(total)}</Text>
                </View>

                {/* Credit toggle */}
                {orgId && (
                  <View style={styles.creditRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.creditLbl}>
                        Bill to {orgName} on credit
                        {isFranchise && <Text style={{ color: '#EF4444', fontWeight: '700' }}> · always on credit</Text>}
                      </Text>
                    </View>
                    <Switch value={isFranchise ? true : onCredit}
                      onValueChange={isFranchise ? undefined : setOnCredit}
                      disabled={isFranchise}
                      trackColor={{ false: '#334155', true: '#0EA5E9' }} thumbColor="#fff" />
                  </View>
                )}

                <TouchableOpacity style={[styles.generateBtn, !hasItems && { opacity: 0.4 }]}
                  onPress={generate} disabled={saving || !hasItems}>
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateText}>Generate Bill  ·  {inr(total)}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      )}

      {/* POST-BILL */}
      {lastBill && (
        <View style={[styles.section, { marginBottom: 32 }]}>
          <View style={[styles.billCard, { borderColor: isPaid ? '#10B98155' : '#F59E0B55' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
              <View>
                <Text style={{ color: '#10B981', fontSize: 16, fontWeight: 'bold' }}>✓ {lastBill.bill_no} created</Text>
                <Text style={{ color: '#64748B', fontSize: 12 }}>{lastBill.patient_name} · {lastBill.items?.length ?? 0} test(s)</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' }}>{inr(lastBill.total)}</Text>
                {!isPaid && <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600' }}>Due {inr(due)}</Text>}
              </View>
            </View>

            {/* Franchise: credit info only */}
            {isFranchise && (
              <View style={styles.creditInfoBox}>
                <Text style={styles.creditInfoText}>
                  Bill added to {orgName}'s credit ledger. Settle from Manage Credit.
                </Text>
              </View>
            )}

            {/* Lab: payment options */}
            {!isFranchise && !isPaid && lastBill.status !== 'credit' && (
              <View style={styles.paySection}>
                <Text style={styles.paySectionLbl}>COLLECT PAYMENT</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#16A34A' }]}
                    onPress={() => payCashUpi('cash')} disabled={!!payingMethod || waiting}>
                    <Text style={styles.payBtnText}>{payingMethod === 'cash' ? '...' : '💵 Cash'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#8B5CF6' }]}
                    onPress={() => payCashUpi('upi')} disabled={!!payingMethod || waiting}>
                    <Text style={styles.payBtnText}>{payingMethod === 'upi' ? '...' : '📲 UPI'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#3B82F6' }]}
                    onPress={payRazorpay} disabled={!!payingMethod || waiting}>
                    <Text style={styles.payBtnText}>{payingMethod === 'razorpay' ? '...' : '💳 Online'}</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.paySectionLbl}>SEND PAYMENT LINK ON WHATSAPP</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput style={[styles.waInput, { flex: 1 }]} value={waPhone} onChangeText={setWaPhone}
                    placeholder="Patient WhatsApp number" placeholderTextColor="#475569"
                    keyboardType="phone-pad" editable={!waiting} />
                  <TouchableOpacity style={[styles.waSendBtn, waiting && { opacity: 0.5 }]}
                    onPress={sendWhatsApp} disabled={waBusy || waiting}>
                    <Text style={styles.waSendText}>{waBusy ? '...' : '💬 Send Bill'}</Text>
                  </TouchableOpacity>
                </View>

                {/* Waiting for payment spinner */}
                {waiting ? (
                  <View style={styles.waitingBox}>
                    <ActivityIndicator color="#8B5CF6" size="small" />
                    <Text style={styles.waitingText}>Waiting for customer payment...</Text>
                    <TouchableOpacity onPress={stopWaiting}>
                      <Text style={{ color: '#64748B', fontSize: 12 }}>Stop</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.waHint}>Patient gets a Razorpay link. App auto-updates when they pay.</Text>
                )}
              </View>
            )}

            {/* Paid */}
            {isPaid && (
              <View style={styles.paidSection}>
                <Text style={styles.paidText}>✓ Fully paid — receipt ready</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#25D366' }]}
                    onPress={sendWhatsApp}>
                    <Text style={styles.payBtnText}>💬 Send Receipt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#F97316' }]}
                    onPress={() => openReceipt(lastBill.id, lastBill.bill_no)}>
                    <Text style={styles.payBtnText}>⬇ Open Receipt</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Receipt button — always available */}
            {!isPaid && (
              <TouchableOpacity style={[styles.payBtn, { backgroundColor: '#334155', marginTop: 12 }]}
                onPress={() => openReceipt(lastBill.id, lastBill.bill_no)}>
                <Text style={styles.payBtnText}>⬇ Open Receipt PDF</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.newBillBtn} onPress={resetForm}>
              <Text style={styles.newBillText}>+ New Bill</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      <View style={{ height: 48 }} />

      {/* PATIENT MODAL */}
      <Modal visible={showPatientModal} transparent animationType="slide" onRequestClose={() => setShowPatientModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Select Patient</Text>
            <TextInput style={styles.modalSearch} value={patientSearch} onChangeText={setPatientSearch}
              placeholder="Search..." placeholderTextColor="#475569" autoFocus />
            <ScrollView style={{ maxHeight: 420 }}>
              {filteredPats.map(p => (
                <TouchableOpacity key={p.id} style={[styles.patItem, patientId === p.id && styles.patItemSel]}
                  onPress={() => { setPatientId(p.id); setPickedTests({}); setPickedGroups({}); setShowPatientModal(false); setPatientSearch(''); }}>
                  <Text style={styles.patName}>{p.patient_name}</Text>
                  <Text style={styles.patBarcode}>{p.barcode}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowPatientModal(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* DISCOUNT PICKER */}
      <Modal visible={showDiscPicker} transparent animationType="slide" onRequestClose={() => setShowDiscPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Discount Type</Text>
            {([['', 'No discount'], ['flat', 'Flat ₹'], ['percent', 'Percent %']] as [string, string][]).map(([val, lbl]) => (
              <TouchableOpacity key={val} style={[styles.patItem, discType === val && styles.patItemSel]}
                onPress={() => { setDiscType(val as any); if (!val) setDiscVal(''); setShowDiscPicker(false); }}>
                <Text style={styles.patName}>{lbl}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDiscPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F172A' },
  loading:        { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  loadingText:    { color: '#64748B', marginTop: 12 },
  section:        { margin: 12, marginBottom: 8 },
  sLabel:         { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  subLabel:       { color: '#334155', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  selector:       { backgroundColor: '#1E293B', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#334155', flexDirection: 'row', alignItems: 'center' },
  selVal:         { flex: 1, color: '#F1F5F9', fontSize: 14 },
  selPh:          { flex: 1, color: '#475569', fontSize: 14 },
  arrow:          { color: '#475569' },
  billingTo:      { fontSize: 13, fontWeight: '600', marginTop: 6 },
  searchInput:    { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 10 },
  testItem:       { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#334155', marginBottom: 6, backgroundColor: '#1E293B' },
  testItemSel:    { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  testName:       { color: '#F1F5F9', fontSize: 14, fontWeight: '500' },
  testSub:        { color: '#475569', fontSize: 11, marginTop: 2 },
  testPrice:      { color: '#10B981', fontSize: 14, fontWeight: '700' },
  addedBadge:     { color: '#10B981', fontSize: 10, marginTop: 2 },
  inGrpBadge:     { color: '#475569', fontSize: 10, marginTop: 2 },
  billCard:       { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#334155' },
  billRow:        { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#334155' },
  billName:       { color: '#F1F5F9', fontSize: 14 },
  grpTag:         { color: '#6366f1', fontSize: 10, fontWeight: '700' },
  billSub:        { color: '#475569', fontSize: 11, marginTop: 2 },
  billPrice:      { color: '#F1F5F9', fontSize: 14, fontWeight: '700', marginLeft: 12 },
  divider:        { height: 1, backgroundColor: '#334155', marginVertical: 10 },
  discLabel:      { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  discTypePicker: { flex: 1.4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0F172A', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  discTypeText:   { color: '#F1F5F9', fontSize: 13 },
  discInput:      { flex: 1, backgroundColor: '#0F172A', color: '#F1F5F9', padding: 10, borderRadius: 8, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  totalRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLbl:       { color: '#64748B', fontSize: 13 },
  totalVal:       { color: '#F1F5F9', fontSize: 13, fontWeight: '600' },
  creditRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#334155' },
  creditLbl:      { color: '#94A3B8', fontSize: 13 },
  generateBtn:    { marginTop: 14, padding: 15, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center' },
  generateText:   { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  creditInfoBox:  { backgroundColor: '#F59E0B15', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#F59E0B33', marginVertical: 8 },
  creditInfoText: { color: '#F59E0B', fontSize: 13 },
  paySection:     { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  paySectionLbl:  { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  payBtn:         { flex: 1, padding: 11, borderRadius: 10, alignItems: 'center' },
  payBtnText:     { color: '#fff', fontWeight: '700', fontSize: 12 },
  waInput:        { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 11, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  waSendBtn:      { backgroundColor: '#25D366', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  waSendText:     { color: '#fff', fontWeight: '700', fontSize: 13 },
  waHint:         { color: '#334155', fontSize: 11, marginTop: 6 },
  waitingBox:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#8B5CF633' },
  waitingText:    { flex: 1, color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
  paidSection:    { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#334155' },
  paidText:       { color: '#10B981', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  newBillBtn:     { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  newBillText:    { color: '#0EA5E9', fontWeight: '700' },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '88%' },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  modalSearch:    { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155', marginBottom: 12 },
  patItem:        { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  patItemSel:     { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  patName:        { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  patBarcode:     { color: '#64748B', fontSize: 12, marginTop: 2 },
  modalCancel:    { marginTop: 12, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
});
