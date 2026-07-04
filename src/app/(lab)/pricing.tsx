import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, Modal, ScrollView,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Test  { id: number; name: string; mrp: number; price: number; }
interface Group { id: number; name: string; }
interface Org   { id: number; name: string; org_group_id: number | null; }
interface Row   { test_id: number; name: string; checked: boolean; mrp: string; price: string; }

type ApplyTo = 'group' | 'org';

export default function Pricing() {
  const [applyTo, setApplyTo]   = useState<ApplyTo>('group');
  const [groups, setGroups]     = useState<Group[]>([]);
  const [orgs, setOrgs]         = useState<Org[]>([]);
  const [tests, setTests]       = useState<Test[]>([]);
  const [loading, setLoading]   = useState(true);

  const [targetGroupId, setTargetGroupId] = useState<number | null>(null);
  const [targetOrgId, setTargetOrgId]     = useState<number | null>(null);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showOrgPicker, setShowOrgPicker]     = useState(false);

  const [rows, setRows]         = useState<Row[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [search, setSearch]     = useState('');
  const [saving, setSaving]     = useState(false);

  // Load master data
  useEffect(() => {
    (async () => {
      try {
        const [g, o, t] = await Promise.all([
          fetch(`${API_BASE}/api/b2b/org-groups`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
          fetch(`${API_BASE}/api/b2b/organizations`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
          fetch(`${API_BASE}/api/b2b/tests`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        ]);
        setGroups(Array.isArray(g) ? g : []);
        setOrgs(Array.isArray(o) ? o : []);
        setTests(Array.isArray(t) ? t : []);
        if (g.length > 0) setTargetGroupId(g[0].id);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  // Load pricing rows when target changes
  const loadRows = useCallback(async (id: number | null, mode: ApplyTo) => {
    if (!id || tests.length === 0) { setRows(tests.map(t => ({ test_id: t.id, name: t.name, checked: false, mrp: String(t.mrp), price: String(t.price) }))); return; }
    setRowsLoading(true);
    try {
      const url = mode === 'group'
        ? `${API_BASE}/api/b2b/org-groups/${id}/tests`
        : `${API_BASE}/api/b2b/organizations/${id}/tests`;
      const res = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      const overrides = new Map((Array.isArray(data) ? data : []).map((d: any) => [d.test_id, d]));
      setRows(tests.map(t => {
        const ov = overrides.get(t.id);
        return {
          test_id: t.id, name: t.name,
          checked: !!ov,
          mrp: String(ov ? ov.mrp : t.mrp),
          price: String(ov ? ov.price : t.price),
        };
      }));
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setRowsLoading(false); }
  }, [tests]);

  useEffect(() => {
    if (tests.length === 0) return;
    if (applyTo === 'group') loadRows(targetGroupId, 'group');
    else loadRows(targetOrgId, 'org');
  }, [applyTo, targetGroupId, targetOrgId, tests, loadRows]);

  const toggleCheck = (testId: number) =>
    setRows(prev => prev.map(r => r.test_id === testId ? { ...r, checked: !r.checked } : r));
  const setMrp   = (testId: number, v: string) => setRows(prev => prev.map(r => r.test_id === testId ? { ...r, mrp: v } : r));
  const setPrice = (testId: number, v: string) => setRows(prev => prev.map(r => r.test_id === testId ? { ...r, price: v } : r));

  const filteredRows = rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase()));
  const selected      = rows.filter(r => r.checked);
  const totalMrp       = selected.reduce((s, r) => s + (Number(r.mrp) || 0), 0);
  const totalPrice     = selected.reduce((s, r) => s + (Number(r.price) || 0), 0);

  const orgsInGroup = orgs.filter(o => o.org_group_id === targetGroupId);

  const savePricing = async () => {
    const targetId = applyTo === 'group' ? targetGroupId : targetOrgId;
    if (!targetId) { Alert.alert('Error', `Select a ${applyTo === 'group' ? 'group' : 'organization'} first`); return; }
    if (selected.length === 0) { Alert.alert('Error', 'Select at least one test'); return; }
    setSaving(true);
    try {
      const payload = selected.map(r => ({ test_id: r.test_id, mrp: Number(r.mrp) || 0, price: Number(r.price) || 0 }));
      const url = applyTo === 'group'
        ? `${API_BASE}/api/b2b/org-groups/${targetId}/tests`
        : `${API_BASE}/api/b2b/organizations/${targetId}/tests`;
      const res = await fetch(url, {
        method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (res.ok) { Alert.alert('✅ Saved', `${j.count} test(s) priced`); }
      else { Alert.alert('Error', 'Could not save pricing'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const renderRow = ({ item: r }: { item: Row }) => (
    <View style={[styles.row, r.checked && styles.rowChecked]}>
      <TouchableOpacity style={styles.checkbox} onPress={() => toggleCheck(r.test_id)}>
        {r.checked && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.testName}>{r.name}</Text>
        {r.checked && (
          <View style={styles.priceRow}>
            <View style={styles.priceField}>
              <Text style={styles.priceLabel}>MRP</Text>
              <TextInput style={styles.priceInput} value={r.mrp} onChangeText={v => setMrp(r.test_id, v)} keyboardType="numeric" />
            </View>
            <View style={styles.priceField}>
              <Text style={styles.priceLabel}>Price</Text>
              <TextInput style={styles.priceInput} value={r.price} onChangeText={v => setPrice(r.test_id, v)} keyboardType="numeric" />
            </View>
          </View>
        )}
      </View>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color="#F97316" size="large" /></View>;

  return (
    <View style={styles.container}>
      <ScrollView>
        <View style={styles.hintBox}>
          <Text style={styles.hint}>Tick the tests a group or organization carries, and set each one's own MRP & price. Editing here never changes the base test.</Text>
        </View>

        {/* Apply to toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity style={[styles.toggleBtn, applyTo === 'group' && styles.toggleBtnActive]} onPress={() => setApplyTo('group')}>
            <Text style={[styles.toggleText, applyTo === 'group' && styles.toggleTextActive]}>Organization Group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toggleBtn, applyTo === 'org' && styles.toggleBtnActive]} onPress={() => setApplyTo('org')}>
            <Text style={[styles.toggleText, applyTo === 'org' && styles.toggleTextActive]}>Organization (standalone)</Text>
          </TouchableOpacity>
        </View>

        {/* Target picker */}
        {applyTo === 'group' ? (
          <TouchableOpacity style={styles.targetSelector} onPress={() => setShowGroupPicker(true)}>
            <Text style={styles.targetLabel}>GROUP</Text>
            <Text style={styles.targetValue}>{groups.find(g => g.id === targetGroupId)?.name ?? 'Select group...'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.targetSelector} onPress={() => setShowOrgPicker(true)}>
            <Text style={styles.targetLabel}>ORGANIZATION</Text>
            <Text style={styles.targetValue}>{orgs.find(o => o.id === targetOrgId && !o.org_group_id)?.name ?? 'Select organization...'}</Text>
          </TouchableOpacity>
        )}

        {/* Orgs in this group */}
        {applyTo === 'group' && targetGroupId && orgsInGroup.length > 0 && (
          <View style={styles.orgsInGroupBox}>
            <Text style={styles.orgsLabel}>ORGANIZATIONS IN THIS GROUP</Text>
            <View style={styles.orgChipRow}>
              {orgsInGroup.map(o => (
                <View key={o.id} style={styles.orgChip}><Text style={styles.orgChipText}>{o.name}</Text></View>
              ))}
            </View>
          </View>
        )}

        {/* Search */}
        <View style={styles.searchWrap}>
          <TextInput style={styles.search} value={search} onChangeText={setSearch}
            placeholder="🔍  Filter by name..." placeholderTextColor="#475569" />
        </View>

        {/* Test rows */}
        {rowsLoading ? <ActivityIndicator color="#F97316" style={{ marginTop: 24 }} /> : (
          <FlatList data={filteredRows} keyExtractor={r => r.test_id.toString()} renderItem={renderRow} scrollEnabled={false} />
        )}
      </ScrollView>

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryStats}>
          <View><Text style={styles.sumLabel}>Selected</Text><Text style={styles.sumVal}>{selected.length}</Text></View>
          <View><Text style={styles.sumLabel}>Total MRP</Text><Text style={[styles.sumVal, { color: '#94A3B8' }]}>{inr(totalMrp)}</Text></View>
          <View><Text style={styles.sumLabel}>Total Price</Text><Text style={[styles.sumVal, { color: '#10B981' }]}>{inr(totalPrice)}</Text></View>
        </View>
        <TouchableOpacity style={[styles.saveBtn, selected.length === 0 && { opacity: 0.4 }]} onPress={savePricing} disabled={saving || selected.length === 0}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Pricing</Text>}
        </TouchableOpacity>
      </View>

      {/* Group picker */}
      <Modal visible={showGroupPicker} transparent animationType="slide" onRequestClose={() => setShowGroupPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Group</Text>
            {groups.map(g => (
              <TouchableOpacity key={g.id} style={[styles.pickerItem, targetGroupId === g.id && styles.pickerItemSel]}
                onPress={() => { setTargetGroupId(g.id); setShowGroupPicker(false); }}>
                <Text style={styles.pickerText}>{g.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowGroupPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Org picker */}
      <Modal visible={showOrgPicker} transparent animationType="slide" onRequestClose={() => setShowOrgPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Organization</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {orgs.filter(o => !o.org_group_id).map(o => (
                <TouchableOpacity key={o.id} style={[styles.pickerItem, targetOrgId === o.id && styles.pickerItemSel]}
                  onPress={() => { setTargetOrgId(o.id); setShowOrgPicker(false); }}>
                  <Text style={styles.pickerText}>{o.name}</Text>
                </TouchableOpacity>
              ))}
              {orgs.filter(o => !o.org_group_id).length === 0 && (
                <Text style={{ color: '#64748B', textAlign: 'center', paddingVertical: 20 }}>
                  No standalone organizations — all are in a group.
                </Text>
              )}
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
  container:       { flex: 1, backgroundColor: '#0F172A' },
  center:          { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  hintBox:         { margin: 12, marginBottom: 8 },
  hint:            { color: '#64748B', fontSize: 12, lineHeight: 18 },
  toggleRow:       { flexDirection: 'row', marginHorizontal: 12, gap: 8, marginBottom: 10 },
  toggleBtn:       { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#334155', backgroundColor: '#1E293B', alignItems: 'center' },
  toggleBtnActive: { borderColor: '#F97316', backgroundColor: '#F9731615' },
  toggleText:      { color: '#64748B', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  toggleTextActive:{ color: '#F97316' },
  targetSelector:  { backgroundColor: '#1E293B', marginHorizontal: 12, marginBottom: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#334155' },
  targetLabel:     { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 4 },
  targetValue:     { color: '#F1F5F9', fontSize: 15, fontWeight: '600' },
  orgsInGroupBox:  { marginHorizontal: 12, marginBottom: 10 },
  orgsLabel:       { color: '#475569', fontSize: 10, fontWeight: '700', letterSpacing: 1, marginBottom: 6 },
  orgChipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  orgChip:         { backgroundColor: '#6366F122', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  orgChipText:     { color: '#818CF8', fontSize: 12, fontWeight: '600' },
  searchWrap:      { paddingHorizontal: 12, marginBottom: 8 },
  search:          { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  row:             { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 12, marginBottom: 6, padding: 12, borderRadius: 10, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155' },
  rowChecked:      { borderColor: '#F97316', backgroundColor: '#F9731610' },
  checkbox:        { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', marginRight: 12, marginTop: 2 },
  checkmark:       { color: '#F97316', fontWeight: 'bold' },
  testName:        { color: '#F1F5F9', fontSize: 14, fontWeight: '600' },
  priceRow:        { flexDirection: 'row', gap: 10, marginTop: 8 },
  priceField:      { flex: 1 },
  priceLabel:      { color: '#64748B', fontSize: 10, marginBottom: 4 },
  priceInput:      { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 8, borderRadius: 8, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  summaryBar:      { backgroundColor: '#1E293B', borderTopWidth: 1, borderTopColor: '#334155', padding: 14, paddingBottom: 20 },
  summaryStats:    { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 10 },
  sumLabel:        { color: '#64748B', fontSize: 10, textAlign: 'center' },
  sumVal:          { color: '#F1F5F9', fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginTop: 2 },
  saveBtn:         { backgroundColor: '#F97316', padding: 14, borderRadius: 10, alignItems: 'center' },
  saveBtnText:     { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  overlay:         { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pickerBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:      { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pickerItem:      { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerItemSel:   { borderColor: '#F97316', backgroundColor: '#F9731615' },
  pickerText:      { color: '#F1F5F9', fontSize: 14 },
  modalCancel:     { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
