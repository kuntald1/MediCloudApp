import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Modal, Alert, Switch, Linking,
} from 'react-native';
import { useLocalSearchParams, router, useFocusEffect } from 'expo-router';
import { authHeader, API_BASE, getUser, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import * as Print from 'expo-print';
import bwipjs from '@bwip-js/react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Patient   { id: number; barcode: string; patient_name: string; organization_id: number | null; phone: string | null; }
interface Test      { id: number; name: string; price: number; mrp: number; sample_type: string; sample_tube_id?: number | null; }
interface TestGroup { id: number; name: string; price: number; tests: { id: number; name: string }[]; test_ids?: number[]; }
interface Org       { id: number; name: string; }
interface Tube      { id: number; name: string; color: string; }

const TUBE_COLOR_MAP: Record<string, string> = {
  lavender: '#C4B5FD', yellow: '#FDE047', red: '#EF4444', blue: '#3B82F6',
  green: '#22C55E', purple: '#A855F7', gray: '#9CA3AF', grey: '#9CA3AF',
  pink: '#F472B6', orange: '#FB923C', black: '#1F2937',
};
const tubeDotColor = (name?: string) => {
  if (!name) return '#64748B';
  const trimmed = name.trim();
  if (trimmed.startsWith('#')) return trimmed; // backend already gave a hex color
  return TUBE_COLOR_MAP[trimmed.toLowerCase()] ?? '#64748B';
};

// ── Sample-label printing (client-side, no backend endpoint needed — the
// patient name, test name, and accession code are all already in app state).
// Each barcode is pre-rendered to a PNG data URL via @bwip-js/react-native
// (runs in the RN JS engine, no DOM needed) and embedded as a plain <img>,
// so the static HTML handed to expo-print needs no script execution at all
// — the native print renderer only paints static markup, it doesn't run JS.
interface LabelItem { patientName: string; testName: string; accession: string; }

async function renderBarcodeDataUri(text: string): Promise<string> {
  const result = await bwipjs.toDataURL({
    bcid: 'code128',
    text,
    scale: 3,
    height: 10,
    includetext: false,
  });
  return result.uri;
}

async function buildLabelsHtml(items: LabelItem[]): Promise<string> {
  const withBarcodes = await Promise.all(items.map(async (it) => ({
    ...it,
    barcodeUri: await renderBarcodeDataUri(it.accession),
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
  const [tubes, setTubes]         = useState<Tube[]>([]);
  const [loading, setLoading]     = useState(true);

  // Effective per-org pricing (Group/Org Pricing overrides) — keyed by test_id
  const [effectivePrices, setEffectivePrices] = useState<Record<number, { price: number; mrp: number; source: string }>>({});
  const [effectiveGroupPrices, setEffectiveGroupPrices] = useState<Record<number, { price: number; mrp: number; source: string }>>({});
  // Accession numbers keyed by TUBE, not by test: one physical tube carries one
  // barcode, so every test drawn into it shares a single number. Editable.
  const [accessions, setAccessions] = useState<Record<string, string>>({});
  const [touchedAccessionIds, setTouchedAccessionIds] = useState<Set<string>>(new Set());
  const [accessionsLoading, setAccessionsLoading] = useState(false);
  const [printing, setPrinting] = useState(false);

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
  const [payAmt, setPayAmt] = useState('');   // how much to collect now — full due by default, editable for part payment
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
      const [p, t, g, o, tb] = await Promise.all([
        fetch(`${API_BASE}/api/patients/`,         { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/tests`,          { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/test-groups`,    { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/organizations`,  { headers: h }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/tubes`,          { headers: h }).then(r => r.ok ? r.json() : []),
      ]);
      setPatients(Array.isArray(p) ? p : []);
      setTests(Array.isArray(t) ? t : []);
      setGroups(Array.isArray(g) ? g : []);
      setOrgs(Array.isArray(o) ? o : []);
      setTubes(Array.isArray(tb) ? tb : []);
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
  const tubeMap  = new Map(tubes.map(tb => [tb.id, tb]));
  const testById = new Map(tests.map(t => [t.id, t]));

  // Which key a test's accession number is allocated against. Must mirror the
  // backend's own grouping (routers/billing.py _tube_key_map) or the preview
  // won't match what gets saved. A test with no tube set can't be grouped.
  const tubeKeyForTest = (id: number) => {
    const t = testById.get(id);
    return t?.sample_tube_id != null ? `tube:${t.sample_tube_id}` : `test:${id}`;
  };
  const accForTest = (id: number) => accessions[tubeKeyForTest(id)] ?? '';

  const groupMemberIds = new Set(
    Object.values(pickedGroups).flatMap(g => (g.test_ids ?? g.tests.map(t => t.id)))
  );
  const groupSubtotal = Object.values(pickedGroups).reduce((s, g) => s + (effectiveGroupPrices[g.id]?.price ?? g.price ?? 0), 0);
  const testSubtotal  = Object.entries(pickedTests).reduce(
    (s, [tid, t]) => s + (effectivePrices[Number(tid)]?.price ?? t.price ?? 0), 0
  );
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

  // ── Resolve effective pricing — applies Group/Org Pricing overrides.
  // Franchise users always see their org's contracted price everywhere,
  // including the test-browsing list before anything is picked, so the
  // whole catalog is resolved as soon as the org is known. Lab admins bill
  // many different orgs from one screen, so for them only the tests already
  // added to the current bill get resolved (shown in Bill Items, not the
  // browsing list) — same as before.
  const standaloneIdsKey = Object.keys(pickedTests).sort().join(',');
  const catalogIdsKey = tests.map(t => t.id).sort((a, b) => a - b).join(',');
  const pricingIdsKey = isFranchise ? catalogIdsKey : standaloneIdsKey;
  useEffect(() => {
    const ids = isFranchise ? tests.map(t => t.id) : Object.keys(pickedTests).map(Number);
    if (!orgId || ids.length === 0) { setEffectivePrices({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('organization_id', String(orgId));
        params.set('test_ids', ids.join(','));
        const res = await fetch(`${API_BASE}/api/billing/resolve?${params.toString()}`, { headers: authHeader() });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        const map: Record<number, { price: number; mrp: number; source: string }> = {};
        data.forEach((r: any) => { map[r.test_id] = { price: r.price, mrp: r.mrp, source: r.source }; });
        setEffectivePrices(map);
      } catch { /* keep base prices on failure */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, pricingIdsKey, isFranchise]);

  // ── Resolve effective pricing for TEST GROUPS (panels) — mirrors the
  // individual-test resolver above via GET /billing/resolve-groups. Franchise
  // users get the whole group catalog resolved up front (same as tests);
  // lab admins only resolve groups already added to the current bill.
  const pickedGroupIdsKey = Object.keys(pickedGroups).sort().join(',');
  const groupCatalogIdsKey = groups.map(g => g.id).sort((a, b) => a - b).join(',');
  const groupPricingIdsKey = isFranchise ? groupCatalogIdsKey : pickedGroupIdsKey;
  useEffect(() => {
    const ids = isFranchise ? groups.map(g => g.id) : Object.keys(pickedGroups).map(Number);
    if (!orgId || ids.length === 0) { setEffectiveGroupPrices({}); return; }
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('organization_id', String(orgId));
        params.set('group_ids', ids.join(','));
        const res = await fetch(`${API_BASE}/api/billing/resolve-groups?${params.toString()}`, { headers: authHeader() });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data)) return;
        const map: Record<number, { price: number; mrp: number; source: string }> = {};
        data.forEach((r: any) => { map[r.group_id] = { price: r.price, mrp: r.mrp, source: r.source }; });
        setEffectiveGroupPrices(map);
      } catch { /* keep base prices on failure */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, groupPricingIdsKey, isFranchise]);

  // ── Auto-generate per-test accession numbers (barcode + suffix letter) for
  // every individual test in the bill — standalone tests and every group
  // member. Always re-fetches ONE fresh, fully-sequential batch sized to the
  // current total test count (next-accessions has no memory of earlier
  // suggestions until a bill is actually saved, so incremental per-test calls
  // would each restart at "A" — this is why it must be a single combined call).
  // Values the person has manually typed are tracked separately and never
  // overwritten by a re-fetch.
  const orderedIndividualIds = [
    ...Object.values(pickedGroups).flatMap(g => g.test_ids ?? g.tests.map(mt => mt.id)),
    ...Object.keys(pickedTests).map(Number),
  ];

  const nameForTest = (id: number) =>
    testById.get(id)?.name
    ?? Object.values(pickedGroups).flatMap(g => g.tests ?? []).find(mt => mt.id === id)?.name
    ?? `Test #${id}`;

  // One row per physical tube — the unit an accession number, a label and a barcode belong to.
  const sampleGroups = (() => {
    const byKey = new Map<string, { key: string; tube: Tube | null; testIds: number[]; names: string[] }>();
    orderedIndividualIds.forEach(id => {
      const k = tubeKeyForTest(id);
      if (!byKey.has(k)) {
        const t = testById.get(id);
        const tb = t?.sample_tube_id != null ? tubeMap.get(t.sample_tube_id) ?? null : null;
        byKey.set(k, { key: k, tube: tb, testIds: [], names: [] });
      }
      const g = byKey.get(k)!;
      g.testIds.push(id);
      g.names.push(nameForTest(id));
    });
    return Array.from(byKey.values());
  })();
  const sampleKeys = sampleGroups.map(g => g.key);
  const sampleKeysKey = sampleKeys.join(',');
  useEffect(() => {
    if (!patient?.barcode || sampleKeys.length === 0) {
      if (sampleKeys.length === 0) { setAccessions({}); setTouchedAccessionIds(new Set()); }
      return;
    }
    let cancelled = false;
    (async () => {
      setAccessionsLoading(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/billing/next-accessions?barcode=${encodeURIComponent(patient.barcode)}&count=${sampleKeys.length}`,
          { headers: authHeader() }
        );
        if (!res.ok) return;
        const data = await res.json();
        const codes: string[] = Array.isArray(data?.accessions) ? data.accessions : [];
        if (cancelled) return;
        setAccessions(prev => {
          const next: Record<string, string> = {};
          let codeIdx = 0;
          sampleKeys.forEach(k => {
            if (touchedAccessionIds.has(k) && prev[k]) {
              next[k] = prev[k]; // keep the person's manual edit as-is
            } else if (codes[codeIdx]) {
              next[k] = codes[codeIdx];
              codeIdx += 1;
            }
          });
          return next;
        });
      } catch { /* leave those tests without a suggested code — still editable manually */ }
      finally { if (!cancelled) setAccessionsLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.barcode, sampleKeysKey]);

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
  // the amount box always starts at the full remaining due — for a new bill, and
  // again after each part payment, so the next instalment is pre-filled.
  useEffect(() => {
    if (!lastBill) { setPayAmt(''); return; }
    const d = Math.max(0, (lastBill.total || 0) - (lastBill.paid || 0));
    setPayAmt(d > 0 ? String(d) : '');
  }, [lastBill?.id, lastBill?.paid, lastBill?.total]);

  const payCashUpi = async (method: 'cash' | 'upi') => {
    if (!lastBill) return;
    const due = Math.max(0, (lastBill.total || 0) - (lastBill.paid || 0));
    if (due <= 0) return;
    // part payment: collect whatever was typed, never more than what's actually due
    const amount = Math.round(Math.min(Number(payAmt) || 0, due) * 100) / 100;
    if (amount <= 0) { Alert.alert('Enter an amount', 'Type how much you are collecting now.'); return; }
    setPayingMethod(method);
    try {
      const res = await fetch(`${API_BASE}/api/billing/bills/${lastBill.id}/payments`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, amount }),
      });
      if (!res.ok) throw new Error('Payment failed');
      const updated = await res.json();
      setLastBill(updated);
      const left = Math.max(0, (updated.total || 0) - (updated.paid || 0));
      Alert.alert('✅ Paid', left > 0
        ? `${inr(amount)} recorded (${method.toUpperCase()})\n${inr(left)} still due`
        : `${inr(amount)} recorded (${method.toUpperCase()})`);
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

    // Client-side duplicate-accession check — mirrors the backend's own validation
    // so the person gets the same clear message without a round trip.
    const seen = new Set<string>();
    for (const g of sampleGroups) {
      const code = (accessions[g.key] ?? '').trim();
      const label = g.tube?.name ?? g.names[0] ?? 'this sample';
      if (!code) {
        Alert.alert('Missing accession number', `Please enter an accession number for the ${label} sample.`);
        return;
      }
      if (seen.has(code)) {
        Alert.alert('Duplicate accession number', `Accession number '${code}' is already in use — please choose a different one for the ${label} sample.`);
        return;
      }
      seen.add(code);
    }

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
        // the API still takes {test_id: accession}; every test on a tube carries that tube's number
        accessions: Object.fromEntries(sampleGroups.flatMap(g =>
          g.testIds.map(id => [String(id), (accessions[g.key] ?? '').trim()]))),
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
      setAccessions({}); setEffectivePrices({}); setTouchedAccessionIds(new Set());
      setWaPhone(patient?.phone ?? '');
      Alert.alert('✅ Bill Created', `${data.bill_no}  ·  ${inr(data.total)}`);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const resetForm = () => {
    setPatientId(null); setPickedTests({}); setPickedGroups({});
    setDiscType(''); setDiscVal(''); setOnCredit(isFranchise);
    setLastBill(null); setWaPhone(''); stopWaiting();
    setAccessions({}); setEffectivePrices({}); setTouchedAccessionIds(new Set());
  };

  // Print a single tube's barcode label
  const printOneSample = async (g: { key: string; tube: Tube | null; names: string[] }) => {
    const code = accessions[g.key];
    const label = g.tube?.name ?? g.names[0] ?? 'this sample';
    if (!code) { Alert.alert('No accession number yet', `Enter or wait for an accession number for the ${label} sample before printing.`); return; }
    setPrinting(true);
    try {
      const html = await buildLabelsHtml([{
        patientName: patient?.patient_name ?? 'Patient',
        testName: (g.tube?.name ? `${g.tube.name} · ` : '') + g.names.join(', '),
        accession: code,
      }]);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print failed', e.message ?? 'Could not generate the barcode label');
    } finally { setPrinting(false); }
  };

  // Print every tube's label in the current bill in one go — a tube carrying
  // several tests is still one sticker.
  const printAllSamples = async () => {
    const items: LabelItem[] = sampleGroups
      .filter(g => accessions[g.key])
      .map(g => ({
        patientName: patient?.patient_name ?? 'Patient',
        testName: (g.tube?.name ? `${g.tube.name} · ` : '') + g.names.join(', '),
        accession: accessions[g.key],
      }));
    if (items.length === 0) { Alert.alert('Nothing to print', 'Add tests and wait for accession numbers to be generated first.'); return; }
    setPrinting(true);
    try {
      const html = await buildLabelsHtml(items);
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print failed', e.message ?? 'Could not generate the barcode labels');
    } finally { setPrinting(false); }
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
      <ActivityIndicator color="#17B9A1" size="large" />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );

  return (
    <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">

      {/* PATIENT */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeaderIcon}>🧑‍⚕️</Text>
          <Text style={styles.sLabel}>PATIENT</Text>
        </View>
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
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeaderIcon}>🧪</Text>
              <Text style={styles.sLabel}>ADD TESTS</Text>
            </View>
            <TextInput style={styles.searchInput} value={testSearch} onChangeText={setTestSearch}
              placeholder="🔍  Search tests or groups..." placeholderTextColor="#475569" />
            {filteredGroups.length > 0 && <>
              <View style={styles.subSectionHeader}>
                <Text style={styles.subLabel}>TEST GROUPS</Text>
              </View>
              {filteredGroups.map(g => {
                const sel = !!pickedGroups[g.id];
                const groupListPrice = effectiveGroupPrices[g.id]?.price ?? g.price;
                const groupListOverridden = effectiveGroupPrices[g.id]?.source === 'group' || effectiveGroupPrices[g.id]?.source === 'organization';
                return (
                  <TouchableOpacity key={g.id} style={[styles.testItem, sel && styles.testItemSel]} onPress={() => toggleGroup(g)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.testName}>{g.name}</Text>
                      <Text style={styles.testSub}>{g.tests.map(t => t.name).join(' · ')}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.testPrice}>{inr(groupListPrice)}</Text>
                      {groupListOverridden && <Text style={styles.overriddenTag}>org price</Text>}
                      {sel && <Text style={styles.addedBadge}>✓ added</Text>}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>}
            {filteredTests.length > 0 && <>
              <View style={[styles.subSectionHeader, { marginTop: 14 }]}>
                <Text style={styles.subLabel}>INDIVIDUAL TESTS</Text>
              </View>
              {filteredTests.map(t => {
                const sel = !!pickedTests[t.id]; const inGrp = groupMemberIds.has(t.id);
                const memberOfGroups = groups.filter(g => (g.test_ids ?? g.tests.map(mt => mt.id)).includes(t.id)).map(g => g.name);
                const listPrice = effectivePrices[t.id]?.price ?? t.price;
                const listOverridden = effectivePrices[t.id]?.source === 'group' || effectivePrices[t.id]?.source === 'organization';
                return (
                  <TouchableOpacity key={t.id}
                    style={[styles.testItem, sel && styles.testItemSel, inGrp && { opacity: 0.45 }]}
                    onPress={() => toggleTest(t)} disabled={inGrp}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.testName}>{t.name}</Text>
                      <Text style={styles.testSub}>{t.sample_type}</Text>
                      {memberOfGroups.length > 0 && (
                        <View style={styles.partOfGroupChip}>
                          <Text style={styles.partOfGroupChipText}>📦 part of: {memberOfGroups.join(', ')}</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.testPrice}>{inr(listPrice)}</Text>
                      {listOverridden && <Text style={styles.overriddenTag}>org price</Text>}
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
              <View style={styles.billItemsHeaderRow}>
                <Text style={styles.sLabel}>BILL ITEMS</Text>
                <TouchableOpacity style={styles.printAllBtn} onPress={printAllSamples} disabled={printing}>
                  {printing ? <ActivityIndicator color="#17B9A1" size="small" /> : <Text style={styles.printAllBtnText}>🖨  Print All Samples</Text>}
                </TouchableOpacity>
              </View>
              {accessionsLoading && (
                <View style={styles.accGenRow}>
                  <ActivityIndicator color="#17B9A1" size="small" />
                  <Text style={styles.accGenText}>Generating accession numbers...</Text>
                </View>
              )}
              <View style={styles.billCard}>
                {Object.entries(pickedGroups).map(([gid, g]) => {
                  const memberIds = g.test_ids ?? g.tests.map(mt => mt.id);
                  const groupBillPrice = effectiveGroupPrices[g.id]?.price ?? g.price;
                  const groupBillOverridden = effectiveGroupPrices[g.id]?.source === 'group' || effectiveGroupPrices[g.id]?.source === 'organization';
                  return (
                    <View key={gid} style={styles.groupWrap}>
                      <View style={styles.groupHeaderRow}>
                        <Text style={styles.groupHeaderName}>{g.name}</Text>
                        <View style={styles.grpTagBadge}><Text style={styles.grpTagBadgeText}>GROUP</Text></View>
                        <View style={{ flex: 1 }} />
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.billPrice}>{inr(groupBillPrice)}</Text>
                          {groupBillOverridden && <Text style={styles.overriddenTag}>org price</Text>}
                        </View>
                      </View>
                      {memberIds.map(mid => {
                        const memberTest = testById.get(mid);
                        const tube = memberTest?.sample_tube_id != null ? tubeMap.get(memberTest.sample_tube_id) : null;
                        const memberName = memberTest?.name ?? g.tests.find(mt => mt.id === mid)?.name ?? `Test #${mid}`;
                        return (
                          <View key={mid} style={styles.memberRow}>
                            <View style={styles.memberConnector} />
                            <View style={{ flex: 1 }}>
                              <View style={styles.memberTopLine}>
                                <Text style={styles.memberName} numberOfLines={1}>{memberName}</Text>
                                {tube && (
                                  <View style={styles.tubeChip}>
                                    <View style={[styles.tubeDot, { backgroundColor: tubeDotColor(tube.color) }]} />
                                    <Text style={styles.tubeChipText}>{tube.name}</Text>
                                  </View>
                                )}
                              </View>
                              {accForTest(mid) !== '' && (
                                <Text style={styles.accRefText}>{accForTest(mid)}</Text>
                              )}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
                {Object.entries(pickedTests).map(([tid, t]) => {
                  const id = Number(tid);
                  const fullTest = testById.get(id);
                  const tube = fullTest?.sample_tube_id != null ? tubeMap.get(fullTest.sample_tube_id) : null;
                  const price = effectivePrices[id]?.price ?? t.price;
                  const overridden = effectivePrices[id]?.source === 'group' || effectivePrices[id]?.source === 'organization';
                  return (
                    <View key={tid} style={styles.standaloneWrap}>
                      <View style={styles.memberTopLine}>
                        <Text style={styles.standaloneName} numberOfLines={1}>{t.name}</Text>
                        {tube && (
                          <View style={styles.tubeChip}>
                            <View style={[styles.tubeDot, { backgroundColor: tubeDotColor(tube.color) }]} />
                            <Text style={styles.tubeChipText}>{tube.name}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }} />
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.billPrice}>{inr(price)}</Text>
                          {overridden && <Text style={styles.overriddenTag}>group price</Text>}
                        </View>
                      </View>
                      {accForTest(id) !== '' && (
                        <Text style={styles.accRefText}>{accForTest(id)}</Text>
                      )}
                    </View>
                  );
                })}
                {sampleGroups.length > 0 && (
                  <View style={styles.sampleBlock}>
                    <Text style={styles.sampleBlockLabel}>SAMPLES TO COLLECT ({sampleGroups.length})</Text>
                    {sampleGroups.map(g => (
                      <View key={g.key} style={styles.sampleRow}>
                        <View style={styles.memberTopLine}>
                          {g.tube ? (
                            <View style={styles.tubeChip}>
                              <View style={[styles.tubeDot, { backgroundColor: tubeDotColor(g.tube.color) }]} />
                              <Text style={styles.tubeChipText}>{g.tube.name}</Text>
                            </View>
                          ) : (
                            <Text style={styles.noTubeText}>No tube set</Text>
                          )}
                          <Text style={styles.sampleNames} numberOfLines={1}>{g.names.join(', ')}</Text>
                        </View>
                        <View style={styles.accRow}>
                          <TextInput
                            style={styles.accInputCompact}
                            value={accessions[g.key] ?? ''}
                            onChangeText={v => { setAccessions(prev => ({ ...prev, [g.key]: v.toUpperCase() })); setTouchedAccessionIds(prev => new Set(prev).add(g.key)); }}
                            placeholder="Accession no." placeholderTextColor="#94A3B8"
                            autoCapitalize="characters"
                          />
                          <TouchableOpacity style={styles.printOneBtn} onPress={() => printOneSample(g)} disabled={printing}>
                            <Text style={styles.printOneBtnIcon}>🖨</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
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
                  <Text style={[styles.totalLbl, { fontSize: 16, color: '#0F172A', fontWeight: 'bold' }]}>Total</Text>
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
                      trackColor={{ false: '#E2E8F0', true: '#17B9A1' }} thumbColor="#fff" />
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
                <Text style={{ color: '#0F172A', fontSize: 18, fontWeight: 'bold' }}>{inr(lastBill.total)}</Text>
                {!isPaid && <Text style={{ color: '#EF4444', fontSize: 12, fontWeight: '600' }}>Due {inr(due)}</Text>}
              </View>
            </View>

            {/* Franchise: credit info only */}
            {isFranchise && (
              <View style={styles.creditInfoBox}>
                <Text style={styles.creditInfoText}>
                  Bill added to {orgName}'s credit ledger. Settle outstanding from Manage Credit.
                </Text>
                <TouchableOpacity onPress={() => router.push('/(franchise)/manage-credit' as any)} style={{ marginTop: 8 }}>
                  <Text style={styles.manageCreditLink}>Manage Credit Limit →</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Lab: payment options */}
            {!isFranchise && !isPaid && lastBill.status !== 'credit' && (
              <View style={styles.paySection}>
                <Text style={styles.paySectionLbl}>COLLECT PAYMENT</Text>
                {/* pre-filled with the full due — lower it to take a part payment */}
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <TextInput style={styles.payAmtInput} value={payAmt} onChangeText={setPayAmt}
                    keyboardType="numeric" placeholder="₹ amount" placeholderTextColor="#475569"
                    editable={!payingMethod && !waiting} />
                  <TouchableOpacity style={styles.payFullBtn} onPress={() => setPayAmt(String(due))}>
                    <Text style={styles.payFullBtnText}>Full {inr(due)}</Text>
                  </TouchableOpacity>
                </View>
                {Number(payAmt) > 0 && Number(payAmt) < due && (
                  <Text style={styles.partPayNote}>Part payment · {inr(due - Number(payAmt))} will stay due</Text>
                )}
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
              <TouchableOpacity style={[styles.payBtn, styles.payBtnOutline, { marginTop: 12 }]}
                onPress={() => openReceipt(lastBill.id, lastBill.bill_no)}>
                <Text style={styles.payBtnOutlineText}>⬇ Open Receipt PDF</Text>
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
            <ScrollView style={{ maxHeight: 360 }}>
              {filteredPats.map(p => (
                <TouchableOpacity key={p.id} style={[styles.patItem, patientId === p.id && styles.patItemSel]}
                  onPress={() => { setPatientId(p.id); setPickedTests({}); setPickedGroups({}); setAccessions({}); setEffectivePrices({}); setTouchedAccessionIds(new Set()); setShowPatientModal(false); setPatientSearch(''); }}>
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
  container:      { flex: 1, backgroundColor: '#F8FAFC' },
  loading:        { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' },
  loadingText:    { color: '#64748B', marginTop: 12 },
  section:        { margin: 12, marginBottom: 8 },
  sectionCard:    {
    backgroundColor: '#FFFFFF', borderRadius: 14, padding: 16, marginHorizontal: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
    shadowColor: '#0F172A', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1,
  },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionHeaderIcon: { fontSize: 15, marginRight: 7 },
  sLabel:         { color: '#17B9A1', fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
  subSectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  subLabel:       { color: '#6366f1', fontSize: 10.5, fontWeight: '800', letterSpacing: 0.8, backgroundColor: '#6366F112', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selector:       { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row', alignItems: 'center' },
  selVal:         { flex: 1, color: '#0F172A', fontSize: 14 },
  selPh:          { flex: 1, color: '#475569', fontSize: 14 },
  arrow:          { color: '#475569' },
  billingTo:      { fontSize: 13, fontWeight: '600', marginTop: 6 },
  searchInput:    { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 10 },
  testItem:       { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 6, backgroundColor: '#FFFFFF' },
  testItemSel:    { borderColor: '#17B9A1', backgroundColor: '#17B9A115' },
  testName:       { color: '#0F172A', fontSize: 14, fontWeight: '500' },
  testSub:        { color: '#475569', fontSize: 11, marginTop: 2 },
  testPrice:      { color: '#10B981', fontSize: 14, fontWeight: '700' },
  addedBadge:     { color: '#10B981', fontSize: 10, marginTop: 2 },
  inGrpBadge:     { color: '#475569', fontSize: 10, marginTop: 2 },
  partOfGroupChip:     { marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#6366F112', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  partOfGroupChipText: { color: '#6366f1', fontSize: 10, fontWeight: '600' },
  billCard:       { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  billRow:        { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  billName:       { color: '#0F172A', fontSize: 14 },
  grpTag:         { color: '#6366f1', fontSize: 10, fontWeight: '700' },
  billSub:        { color: '#475569', fontSize: 11, marginTop: 2 },
  billPrice:      { color: '#0F172A', fontSize: 14, fontWeight: '700', marginLeft: 12 },
  overriddenTag:  { color: '#17B9A1', fontSize: 10, fontWeight: '700', marginTop: 2 },

  // Bill items — group vs standalone visual hierarchy
  billItemsHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  printAllBtn:     { backgroundColor: '#17B9A115', borderWidth: 1, borderColor: '#17B9A155', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  printAllBtnText: { color: '#17B9A1', fontSize: 11, fontWeight: '700' },

  groupWrap:       { backgroundColor: '#6366F108', borderLeftWidth: 3, borderLeftColor: '#6366f1', borderRadius: 8, padding: 10, marginBottom: 12 },
  groupHeaderRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  groupHeaderName: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  grpTagBadge:     { backgroundColor: '#6366f1', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 8 },
  grpTagBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  memberRow:       { flexDirection: 'row', marginTop: 8 },
  memberConnector: { width: 10, borderLeftWidth: 1.5, borderLeftColor: '#6366f155', marginRight: 8 },
  memberTopLine:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName:      { color: '#334155', fontSize: 13, fontWeight: '600', flexShrink: 1 },

  standaloneWrap:  { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, padding: 10, marginBottom: 12 },
  standaloneName:  { color: '#0F172A', fontSize: 14, fontWeight: '600', flexShrink: 1 },

  accRow:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  accInputCompact: { flex: 1, maxWidth: 160, backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, fontSize: 12, fontWeight: '700', borderWidth: 1, borderColor: '#17B9A155' },
  printOneBtn:     { width: 30, height: 30, borderRadius: 8, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  printOneBtnIcon: { fontSize: 13 },

  billGroupBlock: { borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingBottom: 10, marginBottom: 10 },
  billSubItem:    { marginLeft: 14, marginTop: 8 },
  billSubHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  billSubName:    { color: '#475569', fontSize: 13, fontWeight: '600', flex: 1 },
  tubeChip:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, gap: 5 },
  tubeDot:        { width: 8, height: 8, borderRadius: 4 },
  tubeChipText:   { color: '#64748B', fontSize: 10, fontWeight: '600' },
  accRefText:     { color: '#94A3B8', fontSize: 11, marginTop: 3 },
  sampleBlock:    { marginTop: 4, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  sampleBlockLabel: { color: '#64748B', fontSize: 10, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8 },
  sampleRow:      { marginBottom: 10 },
  sampleNames:    { color: '#94A3B8', fontSize: 11, flex: 1 },
  noTubeText:     { color: '#B45309', fontSize: 10, fontWeight: '600' },
  accInput:       { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, fontSize: 13, fontWeight: '600', borderWidth: 1, borderColor: '#17B9A155' },
  accGenRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  accGenText:     { color: '#64748B', fontSize: 12 },
  divider:        { height: 1, backgroundColor: '#E2E8F0', marginVertical: 10 },
  discLabel:      { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  discTypePicker: { flex: 1.4, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  discTypeText:   { color: '#0F172A', fontSize: 13 },
  discInput:      { flex: 1, backgroundColor: '#F8FAFC', color: '#0F172A', padding: 10, borderRadius: 8, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  totalRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLbl:       { color: '#64748B', fontSize: 13 },
  totalVal:       { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  creditRow:      { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  creditLbl:      { color: '#94A3B8', fontSize: 13 },
  generateBtn:    { marginTop: 14, padding: 15, borderRadius: 12, backgroundColor: '#F97316', alignItems: 'center' },
  generateText:   { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  creditInfoBox:  { backgroundColor: '#F59E0B15', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#F59E0B33', marginVertical: 8 },
  creditInfoText: { color: '#F59E0B', fontSize: 13 },
  manageCreditLink: { color: '#F97316', fontSize: 13, fontWeight: '700' },
  paySection:     { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  paySectionLbl:  { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 8 },
  payAmtInput:    { flex: 1, maxWidth: 140, backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 13, fontWeight: '700', borderWidth: 1, borderColor: '#CBD5E1' },
  payFullBtn:     { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1' },
  payFullBtnText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  partPayNote:    { color: '#B45309', fontSize: 11, fontWeight: '600', marginBottom: 8 },
  payBtn:         { flex: 1, padding: 11, borderRadius: 10, alignItems: 'center' },
  payBtnText:     { color: '#fff', fontWeight: '700', fontSize: 12 },
  payBtnOutline:      { backgroundColor: '#17B9A115', borderWidth: 1.5, borderColor: '#17B9A1' },
  payBtnOutlineText:  { color: '#17B9A1', fontWeight: '700', fontSize: 12 },
  waInput:        { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 11, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0' },
  waSendBtn:      { backgroundColor: '#25D366', paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center' },
  waSendText:     { color: '#fff', fontWeight: '700', fontSize: 13 },
  waHint:         { color: '#E2E8F0', fontSize: 11, marginTop: 6 },
  waitingBox:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, backgroundColor: '#8B5CF615', borderRadius: 8, padding: 10, borderWidth: 1, borderColor: '#8B5CF633' },
  waitingText:    { flex: 1, color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
  paidSection:    { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  paidText:       { color: '#10B981', fontWeight: '700', fontSize: 14, marginBottom: 10 },
  newBillBtn:     { marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  newBillText:    { color: '#17B9A1', fontWeight: '700' },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '88%', overflow: 'hidden' },
  modalTitle:     { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  modalSearch:    { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
  patItem:        { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  patItemSel:     { borderColor: '#17B9A1', backgroundColor: '#17B9A115' },
  patName:        { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  patBarcode:     { color: '#64748B', fontSize: 12, marginTop: 2 },
  modalCancel:    { marginTop: 12, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
});
