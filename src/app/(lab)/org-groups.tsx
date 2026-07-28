import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert,
} from 'react-native';

interface Group { id: number; name: string; is_active?: boolean; }
interface Org   { id: number; org_group_id: number | null; }

export default function OrgGroups() {
  const [groups, setGroups]     = useState<Group[]>([]);
  const [orgs, setOrgs]         = useState<Org[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName]         = useState('');
  const [saving, setSaving]     = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [g, o] = await Promise.all([
        fetch(`${API_BASE}/api/b2b/org-groups`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/organizations`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      ]);
      setGroups(Array.isArray(g) ? g : []);
      setOrgs(Array.isArray(o) ? o : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const orgCount = (groupId: number) => orgs.filter(o => o.org_group_id === groupId).length;

  const openAdd  = () => { setName(''); setEditingId(null); setShowForm(true); };
  const openEdit = (g: Group) => { setName(g.name); setEditingId(g.id); setShowForm(true); };

  const save = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Group name required'); return; }
    setSaving(true);
    try {
      const url    = editingId ? `${API_BASE}/api/b2b/org-groups/${editingId}` : `${API_BASE}/api/b2b/org-groups`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'Group updated' : 'Group added');
        setShowForm(false); fetchData();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const deleteGroup = (g: Group) => {
    const count = orgCount(g.id);
    if (count > 0) { Alert.alert('Cannot delete', `${count} organization(s) belong to this group. Move them first.`); return; }
    Alert.alert('Delete Group', `Delete "${g.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/b2b/org-groups/${g.id}`, { method: 'DELETE', headers: authHeader() });
          if (res.ok) { Alert.alert('Deleted'); fetchData(); }
          else { Alert.alert('Error', 'Could not delete'); }
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const renderItem = ({ item: g }: { item: Group }) => {
    const count = orgCount(g.id);
    return (
      <View style={styles.card}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>🏢 {g.name}</Text>
          <View style={styles.orgBadge}>
            <Text style={styles.orgBadgeText}>{count} org{count !== 1 ? 's' : ''}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(g)}>
            <Text style={styles.editBtnText}>✏️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.delBtn} onPress={() => deleteGroup(g)}>
            <Text style={styles.delBtnText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Group</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#F59E0B" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={groups} keyExtractor={(g, i) => (g.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🏢</Text><Text style={styles.emptyText}>No groups found</Text></View>}
          ListFooterComponent={
            <Text style={styles.tip}>
              Tip: assign which tests & prices belong to a group on the Group Pricing screen,
              and put organizations into a group from the Organizations screen.
            </Text>
          }
        />
      )}

      {/* Add/Edit modal */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit Group' : '➕ Add Group'}</Text>
            <Text style={styles.hint}>e.g. B2B, Rural, Golden</Text>

            <Text style={styles.fieldLabel}>Group Name *</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName}
              placeholder="Group name" placeholderTextColor="#475569" />

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Add Group')}</Text>
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
  name:          { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 6 },
  orgBadge:      { backgroundColor: '#6366F122', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, alignSelf: 'flex-start' },
  orgBadgeText:  { color: '#818CF8', fontSize: 11, fontWeight: '700' },
  actionRow:     { flexDirection: 'row', gap: 8 },
  editBtn:       { backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { fontSize: 14 },
  delBtn:        { backgroundColor: '#EF444422', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#EF444444' },
  delBtnText:    { fontSize: 14 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  tip:           { color: '#475569', fontSize: 12, padding: 12, lineHeight: 18 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  hint:          { color: '#64748B', fontSize: 12, marginBottom: 16 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input:         { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
});
