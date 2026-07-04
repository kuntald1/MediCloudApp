import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert,
} from 'react-native';

const COLOR_MAP: Record<string, string> = {
  lavender: '#C4B5FD', yellow: '#FDE047', red: '#EF4444', blue: '#3B82F6',
  green: '#22C55E', purple: '#A855F7', gray: '#9CA3AF', grey: '#9CA3AF',
  pink: '#F472B6', orange: '#FB923C', black: '#1F2937',
};
const dotColor = (name: string) => COLOR_MAP[name?.toLowerCase()] ?? '#64748B';

interface Tube { id: number; name: string; color: string; }

export default function SampleTubes() {
  const [tubes, setTubes]       = useState<Tube[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName]         = useState('');
  const [color, setColor]       = useState('');
  const [saving, setSaving]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/tubes`, { headers: authHeader() });
      const json = await res.json();
      setTubes(Array.isArray(json) ? json : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const openAdd  = () => { setName(''); setColor(''); setEditingId(null); setShowForm(true); };
  const openEdit = (t: Tube) => { setName(t.name); setColor(t.color); setEditingId(t.id); setShowForm(true); };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Tube name required'); return; }
    setSaving(true);
    try {
      const url    = editingId ? `${API_BASE}/api/b2b/tubes/${editingId}` : `${API_BASE}/api/b2b/tubes`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color: color.trim() }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'Tube updated' : 'Tube added');
        setShowForm(false); fetchData();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const deleteTube = (t: Tube) => Alert.alert('Delete Tube', `Delete "${t.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/b2b/tubes/${t.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { Alert.alert('Deleted'); fetchData(); }
        else { Alert.alert('Error', 'Could not delete (may be in use)'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  const renderItem = ({ item: t }: { item: Tube }) => (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name}>🧪 {t.name}</Text>
        <View style={styles.colorRow}>
          <View style={[styles.dot, { backgroundColor: dotColor(t.color) }]} />
          <Text style={styles.colorText}>{t.color}</Text>
        </View>
      </View>
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(t)}>
          <Text style={styles.editBtnText}>✏️</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.delBtn} onPress={() => deleteTube(t)}>
          <Text style={styles.delBtnText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Tube</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={tubes} keyExtractor={(t, i) => (t.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🧪</Text><Text style={styles.emptyText}>No tubes found</Text></View>}
        />
      )}

      {/* Add/Edit modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit Tube' : '➕ Add Tube'}</Text>

            <Text style={styles.fieldLabel}>Tube Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="e.g. EDTA, Serum (Plain)" placeholderTextColor="#475569" />

            <Text style={styles.fieldLabel}>Color</Text>
            <TextInput style={styles.input} value={color} onChangeText={setColor}
              placeholder="e.g. Lavender, Red, Yellow" placeholderTextColor="#475569" />
            {color.trim() !== '' && (
              <View style={styles.previewRow}>
                <View style={[styles.dot, { backgroundColor: dotColor(color) }]} />
                <Text style={styles.previewText}>{color}</Text>
              </View>
            )}

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Add Tube')}</Text>
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
  card:          { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  name:          { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  colorRow:      { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot:           { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: '#334155' },
  colorText:     { color: '#94A3B8', fontSize: 13 },
  actionRow:     { flexDirection: 'row', gap: 8 },
  editBtn:       { backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { fontSize: 14 },
  delBtn:        { backgroundColor: '#EF444422', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#EF444444' },
  delBtnText:    { fontSize: 14 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 16 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 4 },
  input:         { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  previewRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  previewText:   { color: '#94A3B8', fontSize: 13 },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
});
