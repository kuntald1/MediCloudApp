import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, Switch,
} from 'react-native';

interface Branch {
  id: number; name: string; code?: string | null; address?: string | null;
  is_main?: boolean; is_active: boolean;
}

const BLANK = { name: '', code: '', address: '', is_main: false };

export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm]         = useState({ ...BLANK });
  const [saving, setSaving]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/admin/branches`, { headers: authHeader() });
      const json = await res.json();
      setBranches(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openAdd  = () => { setForm({ ...BLANK }); setEditingId(null); setShowForm(true); };
  const openEdit = (b: Branch) => {
    setForm({ name: b.name, code: b.code ?? '', address: b.address ?? '', is_main: !!b.is_main });
    setEditingId(b.id); setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) { Alert.alert('Error', 'Branch name required'); return; }
    setSaving(true);
    try {
      const url    = editingId ? `${API_BASE}/api/admin/branches/${editingId}` : `${API_BASE}/api/admin/branches`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), code: form.code.trim() || null, address: form.address.trim() || null, is_main: form.is_main }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'Branch updated' : 'Branch added');
        setShowForm(false); fetchData();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = (b: Branch) => {
    const action = b.is_active ? 'Deactivate' : 'Activate';
    Alert.alert(`${action} Branch`, `${action} "${b.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, onPress: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/admin/branches/${b.id}`, {
            method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: !b.is_active }),
          });
          if (res.ok) { fetchData(); }
          else { Alert.alert('Error', 'Could not update'); }
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const renderItem = ({ item: b }: { item: Branch }) => (
    <View style={[styles.card, !b.is_active && { opacity: 0.5 }]}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>🌿 {b.name}</Text>
          <View style={styles.tagRow}>
            {b.code && <View style={styles.codeTag}><Text style={styles.codeTagText}>{b.code}</Text></View>}
            {b.is_main && <View style={styles.mainTag}><Text style={styles.mainTagText}>Main</Text></View>}
            <View style={[styles.statusTag, { backgroundColor: b.is_active ? '#10B98122' : '#EF444422' }]}>
              <Text style={[styles.statusTagText, { color: b.is_active ? '#10B981' : '#EF4444' }]}>{b.is_active ? 'Active' : 'Inactive'}</Text>
            </View>
          </View>
        </View>
      </View>
      {b.address && <Text style={styles.address}>📍 {b.address}</Text>}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(b)}>
          <Text style={styles.editBtnText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toggleBtn} onPress={() => toggleActive(b)}>
          <Text style={styles.toggleBtnText}>{b.is_active ? '⏻ Deactivate' : '⏻ Activate'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Branch</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#10B981" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={branches} keyExtractor={(b, i) => (b.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10B981" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🌿</Text><Text style={styles.emptyText}>No branches found</Text></View>}
        />
      )}

      {/* Add/Edit modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit Branch' : '➕ Add Branch'}</Text>

            <Text style={styles.fieldLabel}>Branch Name *</Text>
            <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))}
              placeholder="e.g. Amtala Howrah" placeholderTextColor="#475569" />

            <Text style={styles.fieldLabel}>Code</Text>
            <TextInput style={styles.input} value={form.code} onChangeText={v => setForm(f => ({ ...f, code: v.toUpperCase() }))}
              placeholder="e.g. AMT" placeholderTextColor="#475569" autoCapitalize="characters" />

            <Text style={styles.fieldLabel}>Address</Text>
            <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} value={form.address}
              onChangeText={v => setForm(f => ({ ...f, address: v }))}
              placeholder="Full address" placeholderTextColor="#475569" multiline />

            <View style={styles.switchRow}>
              <Text style={styles.fieldLabel0}>Set as Main Branch</Text>
              <Switch value={form.is_main} onValueChange={v => setForm(f => ({ ...f, is_main: v }))}
                trackColor={{ false: '#334155', true: '#F97316' }} thumbColor="#fff" />
            </View>

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Add Branch')}</Text>
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
  addBtn:        { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:          { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTop:       { marginBottom: 6 },
  name:          { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  tagRow:        { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  codeTag:       { backgroundColor: '#0F172A', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#334155' },
  codeTagText:   { color: '#94A3B8', fontSize: 11, fontFamily: 'monospace' },
  mainTag:       { backgroundColor: '#F97316' + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  mainTagText:   { color: '#F97316', fontSize: 11, fontWeight: '700' },
  statusTag:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusTagText: { fontSize: 11, fontWeight: '700' },
  address:       { color: '#64748B', fontSize: 12, marginBottom: 10 },
  actionRow:     { flexDirection: 'row', gap: 8, marginTop: 4 },
  editBtn:       { flex: 1, backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { color: '#3B82F6', fontWeight: '700', fontSize: 13 },
  toggleBtn:     { flex: 1, backgroundColor: '#EF444422', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#EF444444' },
  toggleBtnText: { color: '#EF4444', fontWeight: '700', fontSize: 13 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  fieldLabel0:   { color: '#94A3B8', fontSize: 13, fontWeight: '600' },
  input:         { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  switchRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, backgroundColor: '#0F172A', padding: 12, borderRadius: 10 },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
});
