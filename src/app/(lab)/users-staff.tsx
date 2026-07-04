import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, ScrollView, TextInput, Alert,
} from 'react-native';

const ROLE_OPTIONS = [
  { value: 'pathologist',  label: 'Doctor (Pathologist)' },
  { value: 'technician',   label: 'Staff — Technician' },
  { value: 'receptionist', label: 'Staff — Receptionist' },
  { value: 'phlebotomist', label: 'Staff — Phlebotomist' },
  { value: 'franchise',    label: 'Organization login' },
];
const roleLabel = (r: string) => ROLE_OPTIONS.find(o => o.value === r)?.label ?? r;
const ROLE_COLOR: Record<string, string> = {
  pathologist: '#16a34a', technician: '#2563eb', receptionist: '#8b5cf6',
  phlebotomist: '#0ea5e9', franchise: '#f97316', lab_admin: '#dc2626',
  super_admin: '#dc2626', lab_staff: '#0ea5e9',
};
const STAFF_ROLES = ['technician', 'receptionist', 'phlebotomist'];

interface User {
  id: number; email: string; role: string; full_name?: string;
  phone?: string | null; branch_id?: number | null; franchise_id?: number | null; is_active: boolean;
}

const BLANK = { full_name: '', email: '', password: '', role: 'technician', franchise_id: null as number | null, branch_id: null as number | null, phone: '' };

export default function UsersStaff() {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [branches, setBranches] = useState<{id:number;name:string}[]>([]);
  const [franchises, setFranchises] = useState<{id:number;name:string}[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm]         = useState({ ...BLANK });
  const [saving, setSaving]     = useState(false);
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [showFranchisePicker, setShowFranchisePicker] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, b, f] = await Promise.all([
        fetch(`${API_BASE}/api/admin/users`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/admin/branches`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      ]);
      setUsers(Array.isArray(u) ? u : u.items ?? []);
      setBranches(Array.isArray(b) ? b : []);
      setFranchises(Array.isArray(f) ? f : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const openAdd  = () => { setForm({ ...BLANK }); setEditingId(null); setShowForm(true); };
  const openEdit = (u: User) => {
    setForm({ full_name: u.full_name ?? '', email: u.email ?? '', password: '', role: u.role,
      franchise_id: u.franchise_id ?? null, branch_id: u.branch_id ?? null, phone: u.phone ?? '' });
    setEditingId(u.id); setShowForm(true);
  };

  const save = async () => {
    if (!form.full_name.trim()) { Alert.alert('Error', 'Name required'); return; }
    if (!editingId && (!form.email.trim() || !form.password.trim())) { Alert.alert('Error', 'Email & password required'); return; }
    if (form.role === 'franchise' && !form.franchise_id) { Alert.alert('Error', 'Pick the organization this login belongs to'); return; }
    setSaving(true);
    try {
      let res;
      if (editingId) {
        res = await fetch(`${API_BASE}/api/admin/users/${editingId}`, {
          method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: form.full_name.trim(), role: form.role, phone: form.phone || null,
            franchise_id: form.franchise_id, branch_id: form.branch_id,
          }),
        });
      } else {
        res = await fetch(`${API_BASE}/api/admin/users`, {
          method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: form.full_name.trim(), email: form.email.trim(), password: form.password,
            role: form.role, phone: form.phone || null,
            franchise_id: form.franchise_id, branch_id: form.branch_id,
          }),
        });
      }
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'User updated' : 'User created');
        setShowForm(false); load();
      } else {
        const e = await res.json().catch(() => ({}));
        Alert.alert('Error', e.detail ?? 'Could not save');
      }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const deleteUser = (u: User) => {
    if (u.role === 'lab_admin' || u.role === 'super_admin') {
      Alert.alert('Not allowed', 'Admin accounts cannot be deleted.'); return;
    }
    Alert.alert('Delete User', `Deactivate ${u.full_name ?? u.email}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/admin/users/${u.id}`, { method: 'DELETE', headers: authHeader() });
          if (res.ok) { Alert.alert('Deactivated'); load(); }
          else { Alert.alert('Error', 'Could not delete'); }
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  const isAdmin = (r: string) => r === 'lab_admin' || r === 'super_admin';

  const renderUser = ({ item: u }: { item: User }) => {
    const color = ROLE_COLOR[u.role] ?? '#64748b';
    return (
      <View style={[styles.card, !u.is_active && { opacity: 0.5 }]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>👤 {u.full_name ?? u.email}</Text>
            <Text style={styles.userEmail}>{u.email}</Text>
            {u.phone && <Text style={styles.userMeta}>📞 {u.phone}</Text>}
          </View>
          <View style={[styles.roleBadge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.roleText, { color }]}>{roleLabel(u.role)}</Text>
          </View>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(u)}>
            <Text style={styles.editBtnText}>✏️ Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.delBtn, isAdmin(u.role) && { opacity: 0.3 }]}
            onPress={() => deleteUser(u)} disabled={isAdmin(u.role)}>
            <Text style={styles.delBtnText}>🗑️ Delete</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const needsBranch = STAFF_ROLES.includes(form.role) || form.role === 'pathologist';

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add User</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#0EA5E9" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={users} keyExtractor={(u, i) => (u.id ?? i).toString()} renderItem={renderUser}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0EA5E9" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>👥</Text><Text style={styles.emptyText}>No users</Text></View>}
        />
      )}

      {/* ── FORM MODAL ── */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit User' : '➕ Add User'}</Text>
            <ScrollView style={{ maxHeight: 480 }}>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              <TextInput style={styles.input} value={form.full_name} onChangeText={v => setForm(f => ({ ...f, full_name: v }))}
                placeholder="Full name" placeholderTextColor="#475569" />

              {/* Email + password only for new users */}
              {!editingId && <>
                <Text style={styles.fieldLabel}>Email *</Text>
                <TextInput style={styles.input} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))}
                  placeholder="email@example.com" placeholderTextColor="#475569" autoCapitalize="none" keyboardType="email-address" />
                <Text style={styles.fieldLabel}>Password *</Text>
                <TextInput style={styles.input} value={form.password} onChangeText={v => setForm(f => ({ ...f, password: v }))}
                  placeholder="Set a password" placeholderTextColor="#475569" secureTextEntry />
              </>}

              <Text style={styles.fieldLabel}>Role</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowRolePicker(true)}>
                <Text style={{ color: '#F1F5F9', fontSize: 14 }}>{roleLabel(form.role)}</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))}
                placeholder="Optional" placeholderTextColor="#475569" keyboardType="phone-pad" />

              {/* Franchise — only for franchise role */}
              {form.role === 'franchise' && <>
                <Text style={styles.fieldLabel}>Organization *</Text>
                <TouchableOpacity style={styles.input} onPress={() => setShowFranchisePicker(true)}>
                  <Text style={{ color: form.franchise_id ? '#F1F5F9' : '#475569', fontSize: 14 }}>
                    {franchises.find(f => f.id === form.franchise_id)?.name ?? 'Select organization...'}
                  </Text>
                </TouchableOpacity>
              </>}

              {/* Branch — for staff & pathologist */}
              {needsBranch && <>
                <Text style={styles.fieldLabel}>Branch (optional)</Text>
                <TouchableOpacity style={styles.input} onPress={() => setShowBranchPicker(true)}>
                  <Text style={{ color: form.branch_id ? '#F1F5F9' : '#475569', fontSize: 14 }}>
                    {branches.find(b => b.id === form.branch_id)?.name ?? 'Any branch'}
                  </Text>
                </TouchableOpacity>
              </>}
            </ScrollView>

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Create User')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Role picker */}
      <Modal visible={showRolePicker} transparent animationType="slide" onRequestClose={() => setShowRolePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Role</Text>
            {ROLE_OPTIONS.map(r => (
              <TouchableOpacity key={r.value} style={[styles.pickerItem, form.role === r.value && styles.pickerItemSel]}
                onPress={() => { setForm(f => ({ ...f, role: r.value })); setShowRolePicker(false); }}>
                <Text style={styles.pickerText}>{r.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowRolePicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Franchise picker */}
      <Modal visible={showFranchisePicker} transparent animationType="slide" onRequestClose={() => setShowFranchisePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Organization</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              {franchises.map(f => (
                <TouchableOpacity key={f.id} style={[styles.pickerItem, form.franchise_id === f.id && styles.pickerItemSel]}
                  onPress={() => { setForm(x => ({ ...x, franchise_id: f.id })); setShowFranchisePicker(false); }}>
                  <Text style={styles.pickerText}>{f.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowFranchisePicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Branch picker */}
      <Modal visible={showBranchPicker} transparent animationType="slide" onRequestClose={() => setShowBranchPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Branch</Text>
            <ScrollView style={{ maxHeight: 320 }}>
              <TouchableOpacity style={[styles.pickerItem, form.branch_id === null && styles.pickerItemSel]}
                onPress={() => { setForm(x => ({ ...x, branch_id: null })); setShowBranchPicker(false); }}>
                <Text style={styles.pickerText}>Any branch</Text>
              </TouchableOpacity>
              {branches.map(b => (
                <TouchableOpacity key={b.id} style={[styles.pickerItem, form.branch_id === b.id && styles.pickerItemSel]}
                  onPress={() => { setForm(x => ({ ...x, branch_id: b.id })); setShowBranchPicker(false); }}>
                  <Text style={styles.pickerText}>{b.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowBranchPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:     { flex: 1, backgroundColor: '#0F172A' },
  addBtn:        { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#0EA5E9', alignItems: 'center' },
  addBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:          { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  userName:      { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold' },
  userEmail:     { color: '#64748B', fontSize: 12, marginTop: 2 },
  userMeta:      { color: '#64748B', fontSize: 12, marginTop: 2 },
  roleBadge:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  roleText:      { fontSize: 11, fontWeight: '700' },
  actionRow:     { flexDirection: 'row', gap: 8 },
  editBtn:       { flex: 1, backgroundColor: '#3B82F622', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#3B82F644' },
  editBtnText:   { color: '#3B82F6', fontWeight: '700', fontSize: 13 },
  delBtn:        { flex: 1, backgroundColor: '#EF444422', padding: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#EF444444' },
  delBtnText:    { color: '#EF4444', fontWeight: '700', fontSize: 13 },
  empty:         { alignItems: 'center', marginTop: 60 },
  emptyIcon:     { fontSize: 48 },
  emptyText:     { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:       { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:    { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  fieldLabel:    { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:         { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155', justifyContent: 'center' },
  formBtns:      { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn:     { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:    { color: '#94A3B8', fontWeight: '600' },
  saveBtn:       { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#0EA5E9', alignItems: 'center' },
  saveText:      { color: '#fff', fontWeight: '700' },
  pickerBox:     { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerItem:    { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerItemSel: { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  pickerText:    { color: '#F1F5F9', fontSize: 14 },
  modalCancel:   { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
});
