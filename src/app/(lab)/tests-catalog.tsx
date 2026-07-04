import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, Modal, ScrollView,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

interface Test  { id: number; name: string; mrp: number; price: number; normal_value?: string; sample_tube_id?: number | null; assigned_doctor_id?: number | null; sample_type?: string; }
interface Tube  { id: number; name: string; }
interface Doctor{ id: number; name: string; }
interface TestGroup { id: number; name: string; code?: string | null; price: number; tests: { id: number; name: string; price: number }[]; test_ids: number[]; sum_price: number; }

type Tab = 'tests' | 'groups';

export default function TestsCatalog() {
  const [tab, setTab]           = useState<Tab>('tests');
  const [tests, setTests]       = useState<Test[]>([]);
  const [groups, setGroups]     = useState<TestGroup[]>([]);
  const [tubes, setTubes]       = useState<Tube[]>([]);
  const [doctors, setDoctors]   = useState<Doctor[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');

  // Inline edit test
  const [editingTestId, setEditingTestId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ mrp: '', price: '', normal_value: '', sample_tube_id: null as number | null, assigned_doctor_id: null as number | null });
  const [savingTest, setSavingTest] = useState(false);
  const [showTubePicker, setShowTubePicker]     = useState(false);
  const [showDoctorPicker, setShowDoctorPicker] = useState(false);

  // Test group form
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<number | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [groupTestIds, setGroupTestIds] = useState<Set<number>>(new Set());
  const [groupPrice, setGroupPrice]     = useState('');
  const [groupTestSearch, setGroupTestSearch] = useState('');
  const [savingGroup, setSavingGroup]   = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [t, g, tb, d] = await Promise.all([
        fetch(`${API_BASE}/api/b2b/tests`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/test-groups`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/tubes`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/doctors`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      ]);
      setTests(Array.isArray(t) ? t : []);
      setGroups(Array.isArray(g) ? g : []);
      setTubes(Array.isArray(tb) ? tb : []);
      setDoctors(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const tubeName   = (id: number | null | undefined) => tubes.find(t => t.id === id)?.name ?? '—';
  const doctorName = (id: number | null | undefined) => doctors.find(d => d.id === id)?.name ?? '—';

  // ── Inline test edit ──
  const startEditTest = (t: Test) => {
    setEditingTestId(t.id);
    setEditForm({
      mrp: String(t.mrp), price: String(t.price), normal_value: t.normal_value ?? '',
      sample_tube_id: t.sample_tube_id ?? null, assigned_doctor_id: t.assigned_doctor_id ?? null,
    });
  };

  const saveTest = async () => {
    if (!editingTestId) return;
    setSavingTest(true);
    try {
      const res = await fetch(`${API_BASE}/api/b2b/tests/${editingTestId}`, {
        method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mrp: Number(editForm.mrp) || 0, price: Number(editForm.price) || 0,
          normal_value: editForm.normal_value || null,
          sample_tube_id: editForm.sample_tube_id, assigned_doctor_id: editForm.assigned_doctor_id,
        }),
      });
      if (res.ok) { setEditingTestId(null); fetchAll(); }
      else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSavingTest(false); }
  };

  const deleteTest = (t: Test) => Alert.alert('Delete Test', `Delete "${t.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/b2b/tests/${t.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { fetchAll(); } else { Alert.alert('Error', 'Could not delete'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  // ── Test group form ──
  const openAddGroup  = () => { setGroupName(''); setGroupCode(''); setGroupTestIds(new Set()); setGroupPrice(''); setEditingGroupId(null); setShowGroupForm(true); };
  const openEditGroup = (g: TestGroup) => {
    setGroupName(g.name); setGroupCode(g.code ?? ''); setGroupTestIds(new Set(g.test_ids)); setGroupPrice(String(g.price));
    setEditingGroupId(g.id); setShowGroupForm(true);
  };

  const toggleGroupTest = (testId: number) => {
    setGroupTestIds(prev => {
      const n = new Set(prev);
      if (n.has(testId)) n.delete(testId); else n.add(testId);
      return n;
    });
  };

  const groupSumOfTests = Array.from(groupTestIds).reduce((s, id) => s + (tests.find(t => t.id === id)?.price ?? 0), 0);
  const resetToSum = () => setGroupPrice(String(groupSumOfTests));

  const saveGroup = async () => {
    if (!groupName.trim()) { Alert.alert('Error', 'Group name required'); return; }
    if (groupTestIds.size === 0) { Alert.alert('Error', 'Select at least one test'); return; }
    setSavingGroup(true);
    try {
      const url    = editingGroupId ? `${API_BASE}/api/b2b/test-groups/${editingGroupId}` : `${API_BASE}/api/b2b/test-groups`;
      const method = editingGroupId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: groupName.trim(), code: groupCode.trim() || null,
          price: Number(groupPrice) || groupSumOfTests, test_ids: Array.from(groupTestIds),
        }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', editingGroupId ? 'Group updated' : 'Group added');
        setShowGroupForm(false); fetchAll();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSavingGroup(false); }
  };

  const deleteGroup = (g: TestGroup) => Alert.alert('Delete Test Group', `Delete "${g.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/b2b/test-groups/${g.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { fetchAll(); } else { Alert.alert('Error', 'Could not delete'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  const filteredTests  = tests.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));
  const filteredGroupTests = tests.filter(t => t.name.toLowerCase().includes(groupTestSearch.toLowerCase()));

  const renderTest = ({ item: t }: { item: Test }) => {
    const editing = editingTestId === t.id;
    return (
      <View style={[styles.card, editing && styles.cardEditing]}>
        <View style={styles.cardTop}>
          <Text style={styles.testName}>{t.name}</Text>
          {!editing && (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => startEditTest(t)}><Text>✏️</Text></TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => deleteTest(t)}><Text>🗑️</Text></TouchableOpacity>
            </View>
          )}
        </View>

        {!editing ? (
          <>
            <View style={styles.priceRow}>
              <Text style={styles.mrpText}>MRP {inr(t.mrp)}</Text>
              <Text style={styles.priceText}>{inr(t.price)}</Text>
            </View>
            <View style={styles.metaGrid}>
              {t.normal_value && <Text style={styles.metaLine}>📊 {t.normal_value}</Text>}
              <Text style={styles.metaLine}>🧪 {tubeName(t.sample_tube_id)}</Text>
              <Text style={styles.metaLine}>👨‍⚕️ {doctorName(t.assigned_doctor_id)}</Text>
            </View>
          </>
        ) : (
          <View style={styles.editForm}>
            <View style={styles.editRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>MRP</Text>
                <TextInput style={styles.input} value={editForm.mrp} onChangeText={v => setEditForm(f => ({ ...f, mrp: v }))} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Price</Text>
                <TextInput style={styles.input} value={editForm.price} onChangeText={v => setEditForm(f => ({ ...f, price: v }))} keyboardType="numeric" />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Normal Value</Text>
            <TextInput style={styles.input} value={editForm.normal_value} onChangeText={v => setEditForm(f => ({ ...f, normal_value: v }))} placeholder="e.g. < 200 mg/dL" placeholderTextColor="#475569" />
            <Text style={styles.fieldLabel}>Sample Tube</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowTubePicker(true)}>
              <Text style={{ color: '#F1F5F9' }}>{tubeName(editForm.sample_tube_id)}</Text>
            </TouchableOpacity>
            <Text style={styles.fieldLabel}>Assigned Doctor</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowDoctorPicker(true)}>
              <Text style={{ color: '#F1F5F9' }}>{doctorName(editForm.assigned_doctor_id)}</Text>
            </TouchableOpacity>
            <View style={styles.editBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditingTestId(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveTest} disabled={savingTest}>
                <Text style={styles.saveText}>{savingTest ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderGroup = ({ item: g }: { item: TestGroup }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.testName}>{g.name}{g.code ? ` (${g.code})` : ''}</Text>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => openEditGroup(g)}><Text>✏️</Text></TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => deleteGroup(g)}><Text>🗑️</Text></TouchableOpacity>
        </View>
      </View>
      <View style={styles.testChipRow}>
        {g.tests.map(t => <View key={t.id} style={styles.testChip}><Text style={styles.testChipText}>{t.name}</Text></View>)}
      </View>
      <View style={styles.priceRow}>
        <Text style={styles.mrpText}>Sum {inr(g.sum_price)}</Text>
        <Text style={styles.priceText}>{inr(g.price)}</Text>
      </View>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator color="#F97316" size="large" /></View>;

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tab, tab === 'tests' && styles.tabActive]} onPress={() => setTab('tests')}>
          <Text style={[styles.tabText, tab === 'tests' && styles.tabTextActive]}>Tests</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, tab === 'groups' && styles.tabActive]} onPress={() => setTab('groups')}>
          <Text style={[styles.tabText, tab === 'groups' && styles.tabTextActive]}>Test Groups</Text>
        </TouchableOpacity>
      </View>

      {tab === 'tests' ? (
        <>
          <View style={styles.searchWrap}>
            <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="🔍  Search tests..." placeholderTextColor="#475569" />
          </View>
          <FlatList data={filteredTests} keyExtractor={t => t.id.toString()} renderItem={renderTest}
            contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🔬</Text><Text style={styles.emptyText}>No tests found</Text></View>}
          />
        </>
      ) : (
        <>
          <TouchableOpacity style={styles.addBtn} onPress={openAddGroup}>
            <Text style={styles.addBtnText}>+ New Test Group</Text>
          </TouchableOpacity>
          <FlatList data={groups} keyExtractor={g => g.id.toString()} renderItem={renderGroup}
            contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>📦</Text><Text style={styles.emptyText}>No test groups</Text></View>}
          />
        </>
      )}

      {/* Tube picker */}
      <Modal visible={showTubePicker} transparent animationType="slide" onRequestClose={() => setShowTubePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Sample Tube</Text>
            <TouchableOpacity style={styles.pickerItem} onPress={() => { setEditForm(f => ({ ...f, sample_tube_id: null })); setShowTubePicker(false); }}>
              <Text style={styles.pickerText}>—</Text>
            </TouchableOpacity>
            {tubes.map(t => (
              <TouchableOpacity key={t.id} style={styles.pickerItem} onPress={() => { setEditForm(f => ({ ...f, sample_tube_id: t.id })); setShowTubePicker(false); }}>
                <Text style={styles.pickerText}>{t.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowTubePicker(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Doctor picker */}
      <Modal visible={showDoctorPicker} transparent animationType="slide" onRequestClose={() => setShowDoctorPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Doctor</Text>
            <TouchableOpacity style={styles.pickerItem} onPress={() => { setEditForm(f => ({ ...f, assigned_doctor_id: null })); setShowDoctorPicker(false); }}>
              <Text style={styles.pickerText}>—</Text>
            </TouchableOpacity>
            <ScrollView style={{ maxHeight: 300 }}>
              {doctors.map(d => (
                <TouchableOpacity key={d.id} style={styles.pickerItem} onPress={() => { setEditForm(f => ({ ...f, assigned_doctor_id: d.id })); setShowDoctorPicker(false); }}>
                  <Text style={styles.pickerText}>{d.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDoctorPicker(false)}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Test Group form */}
      <Modal visible={showGroupForm} transparent animationType="slide" onRequestClose={() => setShowGroupForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingGroupId ? 'Edit Test Group' : 'New Test Group'}</Text>
            <View style={styles.editRow}>
              <View style={{ flex: 2 }}>
                <Text style={styles.fieldLabel}>Group Name</Text>
                <TextInput style={styles.input} value={groupName} onChangeText={setGroupName} placeholder="e.g. lipid profile" placeholderTextColor="#475569" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Code</Text>
                <TextInput style={styles.input} value={groupCode} onChangeText={v => setGroupCode(v.toUpperCase())} placeholder="LIPID" placeholderTextColor="#475569" autoCapitalize="characters" />
              </View>
            </View>

            <Text style={styles.fieldLabel}>Tests in this group</Text>
            <TextInput style={styles.input} value={groupTestSearch} onChangeText={setGroupTestSearch} placeholder="Filter tests..." placeholderTextColor="#475569" />
            <ScrollView style={styles.groupTestList}>
              {filteredGroupTests.map(t => {
                const checked = groupTestIds.has(t.id);
                return (
                  <TouchableOpacity key={t.id} style={[styles.groupTestRow, checked && styles.groupTestRowSel]} onPress={() => toggleGroupTest(t.id)}>
                    <View style={styles.checkbox}>{checked && <Text style={styles.checkmark}>✓</Text>}</View>
                    <Text style={styles.groupTestName}>{t.name}</Text>
                    <Text style={styles.groupTestPrice}>{inr(t.price)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.fieldLabel}>Group Price</Text>
            <View style={styles.editRow}>
              <TextInput style={[styles.input, { flex: 1 }]} value={groupPrice} onChangeText={setGroupPrice} placeholder="0" placeholderTextColor="#475569" keyboardType="numeric" />
              <TouchableOpacity style={styles.resetBtn} onPress={resetToSum}>
                <Text style={styles.resetBtnText}>Sum: {inr(groupSumOfTests)} · reset</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.editBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowGroupForm(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveGroup} disabled={savingGroup}>
                <Text style={styles.saveText}>{savingGroup ? 'Saving...' : 'Save Changes'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#0F172A' },
  center:         { flex: 1, backgroundColor: '#0F172A', justifyContent: 'center', alignItems: 'center' },
  tabRow:         { flexDirection: 'row', margin: 12, marginBottom: 0, backgroundColor: '#1E293B', borderRadius: 10, padding: 4 },
  tab:            { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  tabActive:      { backgroundColor: '#F97316' },
  tabText:        { color: '#64748B', fontWeight: '600', fontSize: 13 },
  tabTextActive:  { color: '#fff' },
  searchWrap:     { padding: 12, paddingBottom: 0 },
  search:         { backgroundColor: '#1E293B', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  addBtn:         { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addBtnText:     { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:           { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardEditing:    { borderColor: '#F97316' },
  cardTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  testName:       { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', flex: 1 },
  actionRow:      { flexDirection: 'row', gap: 6 },
  iconBtn:        { backgroundColor: '#0F172A', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  priceRow:       { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  mrpText:        { color: '#475569', fontSize: 12, textDecorationLine: 'line-through' },
  priceText:      { color: '#10B981', fontSize: 16, fontWeight: 'bold' },
  metaGrid:       { gap: 3 },
  metaLine:       { color: '#64748B', fontSize: 12 },
  testChipRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  testChip:       { backgroundColor: '#F9731622', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  testChipText:   { color: '#F97316', fontSize: 11, fontWeight: '600' },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  editForm:       {},
  editRow:        { flexDirection: 'row', gap: 10, alignItems: 'flex-end' },
  fieldLabel:     { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  input:          { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 10, borderRadius: 8, fontSize: 13, borderWidth: 1, borderColor: '#334155' },
  editBtns:       { flexDirection: 'row', gap: 10, marginTop: 14 },
  cancelBtn:      { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:     { color: '#94A3B8', fontWeight: '600', fontSize: 13 },
  saveBtn:        { flex: 1.5, padding: 12, borderRadius: 8, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:       { color: '#fff', fontWeight: '700', fontSize: 13 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pickerBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pickerItem:     { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerText:     { color: '#F1F5F9', fontSize: 14 },
  modalCancel:    { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
  formBox:        { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, maxHeight: '92%' },
  groupTestList:  { maxHeight: 220, backgroundColor: '#0F172A', borderRadius: 10, marginTop: 8 },
  groupTestRow:   { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  groupTestRowSel:{ backgroundColor: '#F9731615' },
  checkbox:       { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#334155', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkmark:      { color: '#F97316', fontWeight: 'bold', fontSize: 12 },
  groupTestName:  { flex: 1, color: '#F1F5F9', fontSize: 13 },
  groupTestPrice: { color: '#10B981', fontSize: 12, fontWeight: '700' },
  resetBtn:       { justifyContent: 'center', paddingHorizontal: 8 },
  resetBtnText:   { color: '#F97316', fontSize: 11 },
});
