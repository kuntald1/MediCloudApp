/**
 * Cost Estimate — a quote, before anything exists.
 *
 * Pick Direct / walk-in or a franchise, tick tests and groups, and the same
 * resolver billing uses prices them: base rates for Direct, the franchise's
 * own group or organization rate otherwise. A discount comes off the total,
 * and the quote goes out on WhatsApp.
 *
 * Nothing here creates a patient, a bill or a sample.
 *
 * Shared by the lab and franchise portals — a franchise login is pinned to its
 * own organization, the same rule the server enforces.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import { authHeader, API_BASE, getUser } from '../utils/auth';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

interface Org   { id: number; name: string; phone?: string | null; }
interface Item  { id: number; name: string; mrp?: number; price: number; }
interface Rate  { price: number; mrp: number; }

export default function CostEstimateScreen() {
  const me = getUser();
  const isFranchise = (me?.role ?? '').toLowerCase() === 'franchise';

  const [orgs, setOrgs]     = useState<Org[]>([]);
  const [tests, setTests]   = useState<Item[]>([]);
  const [groups, setGroups] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  // null = Direct / walk-in
  const [orgId, setOrgId] = useState<number | null>(isFranchise ? (me?.franchise_id ?? null) : null);
  const [showOrgPicker, setShowOrgPicker] = useState(false);

  const [pickedTests,  setPickedTests]  = useState<number[]>([]);
  const [pickedGroups, setPickedGroups] = useState<number[]>([]);
  const [testRates,  setTestRates]  = useState<Record<number, Rate>>({});
  const [groupRates, setGroupRates] = useState<Record<number, Rate>>({});

  const [search, setSearch]     = useState('');
  const [discount, setDiscount] = useState('');
  const [patientName, setPatientName] = useState('');
  const [toNumber, setToNumber] = useState('');
  const [sending, setSending]   = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/b2b/organizations`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/b2b/tests`,         { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      fetch(`${API_BASE}/api/b2b/packages`,      { headers: authHeader() }).then(r => r.ok ? r.json() : []),
    ]).then(([o, t, g]) => {
      setOrgs(Array.isArray(o) ? o : []);
      setTests(Array.isArray(t) ? t : []);
      setGroups(Array.isArray(g) ? g : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Price the WHOLE catalog for whoever is selected, not just the basket — a
  // franchise rate is not the base rate, and a list price next to a quote that
  // charges another figure is how a lab quotes the wrong number.
  const reprice = useCallback(() => {
    const qs = orgId ? `organization_id=${orgId}&` : '';
    if (tests.length) {
      fetch(`${API_BASE}/api/billing/resolve?${qs}test_ids=${tests.map(t => t.id).join(',')}`, { headers: authHeader() })
        .then(r => r.ok ? r.json() : []).then((rows: any[]) => {
          const m: Record<number, Rate> = {};
          (rows || []).forEach(x => { m[x.test_id] = { price: x.price, mrp: x.mrp }; });
          setTestRates(m);
        }).catch(() => {});
    }
    if (groups.length) {
      fetch(`${API_BASE}/api/billing/resolve-groups?${qs}group_ids=${groups.map(g => g.id).join(',')}`, { headers: authHeader() })
        .then(r => r.ok ? r.json() : []).then((rows: any[]) => {
          const m: Record<number, Rate> = {};
          (rows || []).forEach(x => { m[x.group_id] = { price: x.price, mrp: x.mrp }; });
          setGroupRates(m);
        }).catch(() => {});
    }
  }, [orgId, tests, groups]);

  useEffect(() => { reprice(); }, [reprice]);

  const rateOf = (kind: 'test' | 'group', it: Item) => {
    const r = kind === 'test' ? testRates[it.id] : groupRates[it.id];
    return r ? r.price : (it.price ?? 0);
  };
  const mrpOf = (kind: 'test' | 'group', it: Item) => {
    const r = kind === 'test' ? testRates[it.id] : groupRates[it.id];
    return r ? r.mrp : (it.mrp ?? 0);
  };

  const toggle = (kind: 'test' | 'group', id: number) => {
    const [list, set] = kind === 'test' ? [pickedTests, setPickedTests] : [pickedGroups, setPickedGroups] as const;
    (set as any)(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  };

  const rows = useMemo(() => [
    ...pickedGroups.map(id => {
      const it = groups.find(g => g.id === id) || { id, name: `#${id}`, price: 0 };
      return { kind: 'group' as const, id, name: it.name, price: rateOf('group', it), mrp: mrpOf('group', it) };
    }),
    ...pickedTests.map(id => {
      const it = tests.find(t => t.id === id) || { id, name: `#${id}`, price: 0 };
      return { kind: 'test' as const, id, name: it.name, price: rateOf('test', it), mrp: mrpOf('test', it) };
    }),
  ], [pickedTests, pickedGroups, tests, groups, testRates, groupRates]);

  const priceTotal = rows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  const mrpTotal   = rows.reduce((s, r) => s + (Number(r.mrp)   || 0), 0);
  // Mirrors the server: never negative, never more than the total.
  const disc    = Math.max(0, Math.min(Number(discount) || 0, priceTotal));
  const payable = priceTotal - disc;

  const org      = orgs.find(o => o.id === orgId) || null;
  const orgPhone = org?.phone || '';

  const send = async () => {
    if (!rows.length) { Alert.alert('Nothing to quote', 'Pick at least one test or group.'); return; }
    const to = toNumber.trim() || orgPhone;
    if (!to) {
      Alert.alert('No number', orgId
        ? 'This organization has no phone on file — type a number.'
        : 'Type the WhatsApp number to send to.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/estimates/send`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: orgId,
          test_ids: pickedTests, group_ids: pickedGroups,
          discount: disc, patient_name: patientName.trim() || null,
          to_number: toNumber.trim() || null,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({} as any));
        throw new Error(e.detail || 'send failed');
      }
      Alert.alert('Sent', `Estimate sent to ${to}`);
    } catch (e: any) {
      Alert.alert('Could not send', String(e?.message || 'Please try again.'));
    }
    setSending(false);
  };

  const q = search.trim().toLowerCase();
  const match = (list: Item[]) => q ? list.filter(x => (x.name || '').toLowerCase().includes(q)) : list;

  if (loading) return <View style={styles.center}><ActivityIndicator color="#F97316" size="large" /></View>;

  const sections: { title: string; kind: 'group' | 'test'; items: Item[]; picked: number[] }[] = [
    { title: 'Test Groups', kind: 'group', items: match(groups), picked: pickedGroups },
    { title: 'Tests',       kind: 'test',  items: match(tests),  picked: pickedTests },
  ];

  return (
    <View style={styles.container}>
      <FlatList
        data={sections}
        keyExtractor={s => s.title}
        // enough clear space for the whole quote sheet, or the last test in
        // the list sits under it and cannot be tapped at all
        contentContainerStyle={{ padding: 12, paddingBottom: 460 }}
        ListHeaderComponent={
          <>
            <Text style={styles.fieldLabel}>Estimate for</Text>
            <TouchableOpacity
              style={[styles.input, isFranchise && styles.inputLocked]}
              onPress={() => !isFranchise && setShowOrgPicker(true)}
              disabled={isFranchise}>
              <Text style={{ color: isFranchise ? '#64748B' : '#0F172A', fontSize: 14 }}>
                {org ? org.name : 'Direct / Walk-in'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              {orgId ? 'Franchise rates — group or organization pricing.' : 'Base catalog rates.'}
            </Text>

            <Text style={styles.fieldLabel}>Patient name (optional)</Text>
            <TextInput style={styles.input} value={patientName} onChangeText={setPatientName}
              placeholder="printed on the estimate" placeholderTextColor="#94A3B8" />

            <View style={{ height: 12 }} />
            <TextInput style={styles.input} value={search} onChangeText={setSearch}
              placeholder="🔍  Search tests or groups..." placeholderTextColor="#94A3B8" />
          </>
        }
        renderItem={({ item: sec }) => (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{sec.title} <Text style={styles.sectionCount}>· {sec.items.length}</Text></Text>
            {sec.items.length === 0 ? (
              <Text style={styles.emptyText}>Nothing here.</Text>
            ) : sec.items.map(it => {
              const on = sec.picked.includes(it.id);
              return (
                <TouchableOpacity key={it.id} style={[styles.pickRow, on && styles.pickRowOn]}
                  onPress={() => toggle(sec.kind, it.id)}>
                  <View style={[styles.checkbox, on && styles.checkboxOn]}>
                    {on && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text style={[styles.pickName, on && { fontWeight: '700' }]} numberOfLines={2}>{it.name}</Text>
                  <Text style={styles.pickPrice}>{inr(rateOf(sec.kind, it))}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      />

      {/* the quote, pinned to the bottom */}
      <View style={styles.quote}>
        {/* Kept deliberately short: a taller sheet covers the list behind it,
            and on a small phone the tests become unreachable. Everything below
            the first few lines is reached by scrolling inside this sheet. */}
        <ScrollView style={{ maxHeight: 230 }} keyboardShouldPersistTaps="handled">
          <View style={styles.quoteHead}>
            <Text style={styles.quoteOrg}>{org ? org.name : 'Direct / Walk-in'}</Text>
            <Text style={styles.quoteCount}>{rows.length} item{rows.length === 1 ? '' : 's'}</Text>
          </View>

          {rows.length === 0 ? (
            <Text style={styles.emptyText}>Tick a test or a group to start.</Text>
          ) : (
            <>
              {rows.map(r => (
                <View key={r.kind + r.id} style={styles.quoteRow}>
                  <Text style={styles.quoteName} numberOfLines={1}>
                    {r.name}{r.kind === 'group' ? '  (group)' : ''}
                  </Text>
                  <Text style={styles.quotePrice}>{inr(r.price)}</Text>
                </View>
              ))}
              {mrpTotal > priceTotal && (
                <View style={styles.quoteRow}>
                  <Text style={styles.quoteMuted}>MRP total</Text>
                  <Text style={styles.quoteStrike}>{inr(mrpTotal)}</Text>
                </View>
              )}
              <View style={styles.quoteRow}>
                <Text style={styles.quoteMuted}>Price total</Text>
                <Text style={styles.quoteTotal}>{inr(priceTotal)}</Text>
              </View>
            </>
          )}

          <Text style={styles.fieldLabel}>Discount (₹ off the total)</Text>
          <TextInput style={styles.input} keyboardType="numeric" value={discount}
            onChangeText={setDiscount} placeholder="0" placeholderTextColor="#94A3B8" />
          {Number(discount) > priceTotal && priceTotal > 0 && (
            <Text style={styles.warn}>Capped at the total — payable cannot go below zero.</Text>
          )}

          <Text style={styles.fieldLabel}>Send on WhatsApp</Text>
          {orgId && orgPhone
            ? <Text style={styles.hint}>Goes to {org?.name} on {orgPhone} unless you type another number.</Text>
            : orgId
              ? <Text style={styles.warn}>This organization has no phone on file — type a number.</Text>
              : null}
          <TextInput style={styles.input} keyboardType="phone-pad" value={toNumber} onChangeText={setToNumber}
            placeholder={orgPhone ? `or another number (default ${orgPhone})` : '10-digit mobile'}
            placeholderTextColor="#94A3B8" />
        </ScrollView>

        <View style={styles.payRow}>
          <Text style={styles.payLabel}>Payable</Text>
          <Text style={styles.payValue}>{inr(payable)}</Text>
        </View>
        <TouchableOpacity style={[styles.sendBtn, !rows.length && styles.sendBtnOff]}
          onPress={send} disabled={sending || !rows.length}>
          <Text style={styles.sendText}>{sending ? 'Sending…' : '💬  Send Estimate'}</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showOrgPicker} transparent animationType="slide" onRequestClose={() => setShowOrgPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Estimate for</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <TouchableOpacity style={styles.pickerItem} onPress={() => { setOrgId(null); setShowOrgPicker(false); }}>
                <Text style={styles.pickerText}>Direct / Walk-in</Text>
              </TouchableOpacity>
              {orgs.map(o => (
                <TouchableOpacity key={o.id} style={styles.pickerItem}
                  onPress={() => { setOrgId(o.id); setShowOrgPicker(false); }}>
                  <Text style={styles.pickerText}>{o.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowOrgPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#F8FAFC' },
  center:      { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' },
  fieldLabel:  { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  hint:        { color: '#94A3B8', fontSize: 10.5, marginTop: 4 },
  warn:        { color: '#C2410C', fontSize: 10.5, marginTop: 4 },
  input:       { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  inputLocked: { backgroundColor: '#F1F5F9' },
  card:        { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  sectionTitle:{ color: '#0F172A', fontSize: 14, fontWeight: 'bold', marginBottom: 6 },
  sectionCount:{ color: '#64748B', fontSize: 12, fontWeight: '600' },
  pickRow:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  pickRowOn:   { backgroundColor: '#F9731610' },
  checkbox:    { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxOn:  { borderColor: '#F97316' },
  checkmark:   { color: '#F97316', fontWeight: 'bold', fontSize: 12 },
  pickName:    { flex: 1, color: '#0F172A', fontSize: 13 },
  pickPrice:   { color: '#64748B', fontSize: 12, marginLeft: 8 },
  emptyText:   { color: '#94A3B8', fontSize: 13, paddingVertical: 10 },
  quote:       { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF',
                 borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 22,
                 borderTopWidth: 1, borderTopColor: '#E2E8F0', elevation: 12,
                 shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -4 } },
  quoteHead:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  quoteOrg:    { color: '#0F172A', fontSize: 15, fontWeight: 'bold' },
  quoteCount:  { color: '#64748B', fontSize: 12 },
  quoteRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#F7F8FB' },
  quoteName:   { color: '#0F172A', fontSize: 13, fontWeight: '600', flex: 1, marginRight: 8 },
  // a total's figure must not take flex, or it ends up glued to its label
  quoteTotal:  { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  quotePrice:  { color: '#10B981', fontSize: 13, fontWeight: '700' },
  quoteMuted:  { color: '#64748B', fontSize: 12.5 },
  quoteStrike: { color: '#94A3B8', fontSize: 12.5, textDecorationLine: 'line-through' },
  payRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
                 borderTopWidth: 2, borderTopColor: '#0F172A', paddingTop: 8, marginTop: 10 },
  payLabel:    { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  payValue:    { color: '#F97316', fontSize: 22, fontWeight: '800' },
  sendBtn:     { marginTop: 10, backgroundColor: '#16A34A', borderRadius: 10, padding: 14, alignItems: 'center' },
  sendBtnOff:  { backgroundColor: '#CBD5E1' },
  sendText:    { color: '#fff', fontWeight: '700', fontSize: 15 },
  overlay:     { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pickerBox:   { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:  { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pickerItem:  { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  pickerText:  { color: '#0F172A', fontSize: 14 },
  modalCancel: { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
