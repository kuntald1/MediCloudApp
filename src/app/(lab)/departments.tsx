import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert,
} from 'react-native';

interface Department { id: number; name: string; code: string | null; is_active: boolean; }

export default function Departments() {
  const [depts, setDepts]       = useState<Department[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName]         = useState('');
  const [code, setCode]         = useState('');
  const [saving, setSaving]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/catalog/departments`, { headers: authHeader() });
      const json = await res.json();
      const list: Department[] = Array.isArray(json) ? json : [];
      setDepts(list.filter(d => d.is_active !== false));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openAdd  = () => { setName(''); setCode(''); setEditingId(null); setShowForm(true); };
  const openEdit = (d: Department) => { setName(d.name); setCode(d.code ?? ''); setEditingId(d.id); setShowForm(true); };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Department name required'); return; }
    setSaving(true);
    try {
      const url    = editingId ? `${API_BASE}/api/catalog/departments/${editingId}` : `${API_BASE}/api/catalog/departments`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), code: code.trim() || null }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'Department updated' : 'Department added');
        setShowForm(false); fetchData();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const deleteDept = (d: Department) => Alert.alert('Delete Department', `Delete "${d.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/catalog/departments/${d.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { Alert.alert('Deleted'); fetchData(); }
        else { Alert.alert('Error', 'Could not delete (may be in use)'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  const renderItem = ({ item: d }: { item: Department }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>🏬 {d.name}</Text>
        {d.code ? <Text style={styles.codeText}>Code: {d.code}</Text> : null}
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(d)}>
          <Text style={styles.editBtnText}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.delBtn} onPress={() => deleteDept(d)}>
          <Text style={styles.delBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Department</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={depts} keyExtractor={(d, i) => (d.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🏬</Text><Text style={styles.emptyText}>No departments found</Text></View>}
        />
      )}

      {/* Add/Edit modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit Department' : '➕ Add Department'}</Text>

            <Text style={styles.fieldLabel}>Department Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="e.g. Registration, Accession, Finance, Operation" placeholderTextColor="#475569" />

            <Text style={styles.fieldLabel}>Code (optional)</Text>
            <TextInput style={styles.input} value={code} onChangeText={setCode}
              placeholder="e.g. REG, ACC" placeholderTextColor="#475569" autoCapitalize="characters" />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Add Department')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#F8FAFC' },
  addBtn:        { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  name:          { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  codeText:      { color: '#94A3B8', fontSize: 13 },
  actionRow:     { flexDirection: 'row', gap: 8 },
  editBtn:       { backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { fontSize: 14 },
  delBtn:        { backgroundColor: '#EF444422', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#EF444444' },
  delBtnText:    { fontSize: 14 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  input:         { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
});
