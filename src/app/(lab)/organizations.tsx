import { authHeader, API_BASE } from '../../../src/utils/auth';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  RefreshControl, Modal, TextInput, Alert, ScrollView,
} from 'react-native';

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fmtDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

const ENTRY_TYPES = [
  { value: 'payment',    label: 'Payment received (−)', direction: 'credit' },
  { value: 'bill',       label: 'Manual charge (+)',     direction: 'debit'  },
  { value: 'adjustment', label: 'Adjustment',            direction: 'credit' },
];

interface Org {
  id: number; name: string; org_group_id: number | null;
  contact_person?: string | null; phone?: string | null; email?: string | null;
  pan?: string | null; aadhaar?: string | null; gstin?: string | null;
  address?: string | null; credit_limit: number; is_active: boolean;
}
interface Group { id: number; name: string; }

const BLANK = { name: '', org_group_id: null as number | null, contact_person: '', phone: '', email: '', pan: '', aadhaar: '', gstin: '', address: '', credit_limit: '0' };

export default function Organizations() {
  const [orgs, setOrgs]         = useState<Org[]>([]);
  const [groups, setGroups]     = useState<Group[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Form
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm]         = useState({ ...BLANK });
  const [saving, setSaving]     = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  // Ledger
  const [ledgerOrg, setLedgerOrg] = useState<Org | null>(null);
  const [ledger, setLedger]       = useState<any>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryType, setEntryType]   = useState('payment');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryRef, setEntryRef]     = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);

  // WhatsApp
  const [waOrg, setWaOrg]       = useState<Org | null>(null);
  const [waMsg, setWaMsg]       = useState('');
  const [waSending, setWaSending] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [o, g] = await Promise.all([
        fetch(`${API_BASE}/api/b2b/organizations`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
        fetch(`${API_BASE}/api/b2b/org-groups`, { headers: authHeader() }).then(r => r.ok ? r.json() : []),
      ]);
      setOrgs(Array.isArray(o) ? o : []);
      setGroups(Array.isArray(g) ? g : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const groupName = (id: number | null) => groups.find(g => g.id === id)?.name ?? 'Standalone';

  // ── Add/Edit ──
  const openAdd  = () => { setForm({ ...BLANK }); setEditingId(null); setShowForm(true); };
  const openEdit = (o: Org) => {
    setForm({
      name: o.name, org_group_id: o.org_group_id, contact_person: o.contact_person ?? '',
      phone: o.phone ?? '', email: o.email ?? '', pan: o.pan ?? '', aadhaar: o.aadhaar ?? '',
      gstin: o.gstin ?? '', address: o.address ?? '', credit_limit: String(o.credit_limit ?? 0),
    });
    setEditingId(o.id); setShowForm(true);
  };

  const saveOrg = async () => {
    if (!form.name.trim()) { Alert.alert('Error', 'Organization name required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), org_group_id: form.org_group_id,
        address: form.address || null, pan: form.pan || null, aadhaar: form.aadhaar || null,
        gstin: form.gstin || null, contact_person: form.contact_person || null,
        phone: form.phone || null, email: form.email || null,
        credit_limit: Number(form.credit_limit) || 0,
      };
      const url    = editingId ? `${API_BASE}/api/b2b/organizations/${editingId}` : `${API_BASE}/api/b2b/organizations`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { ...authHeader(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.ok) {
        Alert.alert('✅ Saved', editingId ? 'Organization updated' : 'Organization added');
        setShowForm(false); fetchData();
      } else { Alert.alert('Error', 'Could not save'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  const deleteOrg = (o: Org) => Alert.alert('Delete Organization', `Delete "${o.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      try {
        const res = await fetch(`${API_BASE}/api/b2b/organizations/${o.id}`, { method: 'DELETE', headers: authHeader() });
        if (res.ok) { Alert.alert('Deleted'); fetchData(); }
        else { Alert.alert('Error', 'Could not delete'); }
      } catch (e: any) { Alert.alert('Error', e.message); }
    }},
  ]);

  // ── Ledger ──
  const openLedger = async (o: Org) => {
    setLedgerOrg(o); setLedgerLoading(true); setLedger(null); setShowEntryForm(false);
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/organizations/${o.id}/ledger`, { headers: authHeader() });
      const data = await res.json();
      setLedger(data);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLedgerLoading(false); }
  };

  const saveEntry = async () => {
    if (!ledgerOrg) return;
    const amt = Number(entryAmount);
    if (!amt || amt <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }
    setSavingEntry(true);
    try {
      const typeInfo = ENTRY_TYPES.find(t => t.value === entryType)!;
      const res = await fetch(`${API_BASE}/api/b2b/organizations/${ledgerOrg.id}/ledger/entry`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_type: entryType, amount: amt, direction: typeInfo.direction, ref: entryRef || null }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        Alert.alert('✅ Saved', `New outstanding: ${inr(j.outstanding)}`);
        setShowEntryForm(false); setEntryAmount(''); setEntryRef(''); setEntryType('payment');
        openLedger(ledgerOrg); fetchData();
      } else { Alert.alert('Error', 'Could not save entry'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSavingEntry(false); }
  };

  // ── WhatsApp ──
  const openWhatsApp = (o: Org) => { setWaOrg(o); setWaMsg(`Dear ${o.name},\n\n`); };
  const sendWhatsApp = async () => {
    if (!waOrg) return;
    setWaSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/b2b/organizations/${waOrg.id}/whatsapp`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: waMsg }),
      });
      const j = await res.json();
      if (res.ok && j.sent) { Alert.alert('✅ Sent', `Sent to ${j.to}`); setWaOrg(null); }
      else { Alert.alert('Error', 'Could not send'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setWaSending(false); }
  };

  const renderOrg = ({ item: o }: { item: Org }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>🏛️ {o.name}</Text>
          <View style={styles.groupBadge}><Text style={styles.groupBadgeText}>{groupName(o.org_group_id)}</Text></View>
        </View>
        {!o.is_active && <View style={styles.inactiveBadge}><Text style={styles.inactiveText}>Inactive</Text></View>}
      </View>
      {o.contact_person && <Text style={styles.meta}>👤 {o.contact_person}</Text>}
      {o.phone && <Text style={styles.meta}>📞 {o.phone}</Text>}
      {o.email && <Text style={styles.meta}>✉️ {o.email}</Text>}
      <View style={styles.creditRow}>
        <Text style={styles.creditLabel}>Credit Limit</Text>
        <Text style={styles.creditVal}>{inr(o.credit_limit)}</Text>
      </View>
      <View style={styles.actionGrid}>
        <TouchableOpacity style={styles.actBtn} onPress={() => openLedger(o)}>
          <Text style={styles.actBtnText}>📒 Ledger</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actBtn, !o.phone && { opacity: 0.4 }]} onPress={() => o.phone && openWhatsApp(o)} disabled={!o.phone}>
          <Text style={styles.actBtnText}>💬 WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actBtn} onPress={() => openEdit(o)}>
          <Text style={styles.actBtnText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actBtn, styles.delActBtn]} onPress={() => deleteOrg(o)}>
          <Text style={[styles.actBtnText, { color: '#EF4444' }]}>🗑️ Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Organization</Text>
      </TouchableOpacity>

      {loading ? <ActivityIndicator color="#10B981" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={orgs} keyExtractor={(o, i) => (o.id ?? i).toString()} renderItem={renderOrg}
          contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10B981" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>🏛️</Text><Text style={styles.emptyText}>No organizations found</Text></View>}
        />
      )}

      {/* ── ADD/EDIT FORM ── */}
      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{editingId ? '✏️ Edit Organization' : '➕ New Organization'}</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              <Text style={styles.fieldLabel}>Organization Name *</Text>
              <TextInput style={styles.input} value={form.name} onChangeText={v => setForm(f => ({ ...f, name: v }))}
                placeholder="Organization name" placeholderTextColor="#475569" />

              <Text style={styles.fieldLabel}>Group</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowGroupPicker(true)}>
                <Text style={{ color: form.org_group_id ? '#F1F5F9' : '#475569', fontSize: 14 }}>
                  {groups.find(g => g.id === form.org_group_id)?.name ?? 'Standalone'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Contact Person</Text>
              <TextInput style={styles.input} value={form.contact_person} onChangeText={v => setForm(f => ({ ...f, contact_person: v }))}
                placeholder="Contact name" placeholderTextColor="#475569" />

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput style={styles.input} value={form.phone} onChangeText={v => setForm(f => ({ ...f, phone: v }))}
                placeholder="10-digit mobile" placeholderTextColor="#475569" keyboardType="phone-pad" />

              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput style={styles.input} value={form.email} onChangeText={v => setForm(f => ({ ...f, email: v }))}
                placeholder="email@example.com" placeholderTextColor="#475569" autoCapitalize="none" keyboardType="email-address" />

              <Text style={styles.fieldLabel}>Credit Limit (₹)</Text>
              <TextInput style={styles.input} value={form.credit_limit} onChangeText={v => setForm(f => ({ ...f, credit_limit: v }))}
                placeholder="0" placeholderTextColor="#475569" keyboardType="numeric" />

              <Text style={styles.fieldLabel}>PAN</Text>
              <TextInput style={styles.input} value={form.pan} onChangeText={v => setForm(f => ({ ...f, pan: v }))}
                placeholder="ABCDE1234F" placeholderTextColor="#475569" autoCapitalize="characters" />

              <Text style={styles.fieldLabel}>Aadhaar</Text>
              <TextInput style={styles.input} value={form.aadhaar} onChangeText={v => setForm(f => ({ ...f, aadhaar: v }))}
                placeholder="12-digit" placeholderTextColor="#475569" keyboardType="numeric" />

              <Text style={styles.fieldLabel}>GSTIN</Text>
              <TextInput style={styles.input} value={form.gstin} onChangeText={v => setForm(f => ({ ...f, gstin: v }))}
                placeholder="22ABCDE1234F1Z5" placeholderTextColor="#475569" autoCapitalize="characters" />

              <Text style={styles.fieldLabel}>Address</Text>
              <TextInput style={[styles.input, { height: 70, textAlignVertical: 'top' }]} value={form.address}
                onChangeText={v => setForm(f => ({ ...f, address: v }))}
                placeholder="Full address" placeholderTextColor="#475569" multiline />
            </ScrollView>

            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveOrg} disabled={saving}>
                <Text style={styles.saveText}>{saving ? 'Saving...' : (editingId ? 'Update' : 'Add Organization')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Group picker */}
      <Modal visible={showGroupPicker} transparent animationType="slide" onRequestClose={() => setShowGroupPicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Select Group</Text>
            <TouchableOpacity style={[styles.pickerItem, form.org_group_id === null && styles.pickerItemSel]}
              onPress={() => { setForm(f => ({ ...f, org_group_id: null })); setShowGroupPicker(false); }}>
              <Text style={styles.pickerText}>Standalone</Text>
            </TouchableOpacity>
            {groups.map(g => (
              <TouchableOpacity key={g.id} style={[styles.pickerItem, form.org_group_id === g.id && styles.pickerItemSel]}
                onPress={() => { setForm(f => ({ ...f, org_group_id: g.id })); setShowGroupPicker(false); }}>
                <Text style={styles.pickerText}>{g.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowGroupPicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── LEDGER MODAL ── */}
      <Modal visible={!!ledgerOrg} transparent animationType="slide" onRequestClose={() => setLedgerOrg(null)}>
        <View style={styles.overlay}>
          <View style={styles.ledgerBox}>
            <View style={styles.ledgerHeader}>
              <View>
                <Text style={styles.ledgerName}>📒 {ledgerOrg?.name}</Text>
                <Text style={styles.ledgerSub}>Credit & debit ledger</Text>
              </View>
              <TouchableOpacity onPress={() => setLedgerOrg(null)}><Text style={styles.closeX}>✕</Text></TouchableOpacity>
            </View>

            {ledgerLoading ? <ActivityIndicator color="#10B981" style={{ marginVertical: 30 }} /> : ledger && (
              <>
                <View style={styles.summaryRow}>
                  <View style={[styles.sumBox, { borderColor: '#EF444455', borderWidth: 1 }]}>
                    <Text style={styles.sumLabel}>Outstanding</Text>
                    <Text style={[styles.sumVal, { color: '#EF4444' }]}>{inr(ledger.outstanding)}</Text>
                  </View>
                  <View style={styles.sumBox}>
                    <Text style={styles.sumLabel}>Credit Limit</Text>
                    <Text style={styles.sumVal}>{inr(ledger.organization?.credit_limit ?? 0)}</Text>
                  </View>
                </View>

                {!showEntryForm ? (
                  <TouchableOpacity style={styles.addEntryBtn} onPress={() => setShowEntryForm(true)}>
                    <Text style={styles.addEntryText}>+ Add Entry</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.entryForm}>
                    <Text style={styles.fieldLabel}>Type</Text>
                    <TouchableOpacity style={styles.input} onPress={() => setShowTypePicker(true)}>
                      <Text style={{ color: '#F1F5F9', fontSize: 13 }}>{ENTRY_TYPES.find(t => t.value === entryType)?.label}</Text>
                    </TouchableOpacity>
                    <Text style={styles.fieldLabel}>Amount (₹)</Text>
                    <TextInput style={styles.input} value={entryAmount} onChangeText={setEntryAmount}
                      placeholder="0.00" placeholderTextColor="#475569" keyboardType="numeric" />
                    <Text style={styles.fieldLabel}>Reference / Note (optional)</Text>
                    <TextInput style={styles.input} value={entryRef} onChangeText={setEntryRef}
                      placeholder="e.g. cheque no., UTR, remark" placeholderTextColor="#475569" />
                    <View style={styles.formBtns}>
                      <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowEntryForm(false)}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveBtn} onPress={saveEntry} disabled={savingEntry}>
                        <Text style={styles.saveText}>{savingEntry ? 'Saving...' : 'Save Entry'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <Text style={styles.ledgerTitle}>Entries</Text>
                <ScrollView style={{ maxHeight: 300 }}>
                  {(ledger.entries ?? []).map((e: any, i: number) => (
                    <View key={e.id ?? i} style={styles.entryRow}>
                      <View style={[styles.typeBadge, { backgroundColor: e.type === 'payment' ? '#10B98122' : '#EF444422' }]}>
                        <Text style={[styles.typeBadgeText, { color: e.type === 'payment' ? '#10B981' : '#EF4444' }]}>
                          {e.type === 'payment' ? 'Payment' : e.type === 'bill' ? 'Invoice' : 'Adjust'}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={styles.entryRef}>{e.ref ?? '—'}</Text>
                        <Text style={styles.entryDate}>{fmtDate(e.created_at)}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.entryAmt, { color: e.type === 'payment' ? '#10B981' : '#EF4444' }]}>
                          {e.type === 'payment' ? '−' : '+'} {inr(e.amount)}
                        </Text>
                        <Text style={styles.entryBal}>{inr(e.balance_after)}</Text>
                      </View>
                    </View>
                  ))}
                  {(ledger.entries ?? []).length === 0 && <Text style={styles.noData}>No entries</Text>}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Entry type picker */}
      <Modal visible={showTypePicker} transparent animationType="fade" onRequestClose={() => setShowTypePicker(false)}>
        <View style={styles.overlay}>
          <View style={styles.pickerBox}>
            <Text style={styles.modalTitle}>Entry Type</Text>
            {ENTRY_TYPES.map(t => (
              <TouchableOpacity key={t.value} style={[styles.pickerItem, entryType === t.value && styles.pickerItemSel]}
                onPress={() => { setEntryType(t.value); setShowTypePicker(false); }}>
                <Text style={styles.pickerText}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowTypePicker(false)}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── WHATSAPP MODAL ── */}
      <Modal visible={!!waOrg} transparent animationType="slide" onRequestClose={() => setWaOrg(null)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>💬 WhatsApp {waOrg?.name}</Text>
            <Text style={styles.hint}>To: {waOrg?.phone}</Text>
            <TextInput style={[styles.input, { height: 120, textAlignVertical: 'top' }]}
              value={waMsg} onChangeText={setWaMsg} multiline
              placeholder="Message..." placeholderTextColor="#475569" />
            <View style={styles.formBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setWaOrg(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: '#25D366' }]} onPress={sendWhatsApp} disabled={waSending}>
                <Text style={styles.saveText}>{waSending ? 'Sending...' : '💬 Send'}</Text>
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
  addBtn:         { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addBtnText:     { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  card:           { backgroundColor: '#1E293B', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  cardTop:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  name:           { color: '#F1F5F9', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  groupBadge:     { backgroundColor: '#6366F122', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, alignSelf: 'flex-start' },
  groupBadgeText: { color: '#818CF8', fontSize: 10, fontWeight: '600' },
  inactiveBadge:  { backgroundColor: '#EF444422', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  inactiveText:   { color: '#EF4444', fontSize: 10, fontWeight: '700' },
  meta:           { color: '#64748B', fontSize: 12, marginTop: 3 },
  creditRow:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#334155' },
  creditLabel:    { color: '#64748B', fontSize: 12 },
  creditVal:      { color: '#0EA5E9', fontSize: 13, fontWeight: '700' },
  actionGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  actBtn:         { flexBasis: '48%', backgroundColor: '#0F172A', padding: 9, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  delActBtn:      { borderColor: '#EF444444' },
  actBtnText:     { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:        { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 },
  modalTitle:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold', marginBottom: 4 },
  hint:           { color: '#64748B', fontSize: 12, marginBottom: 12 },
  fieldLabel:     { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input:          { backgroundColor: '#0F172A', color: '#F1F5F9', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#334155' },
  formBtns:       { flexDirection: 'row', gap: 12, marginTop: 16 },
  cancelBtn:      { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  cancelText:     { color: '#94A3B8', fontWeight: '600' },
  saveBtn:        { flex: 1.5, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:       { color: '#fff', fontWeight: '700' },
  pickerBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerItem:     { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#334155' },
  pickerItemSel:  { borderColor: '#0EA5E9', backgroundColor: '#0EA5E915' },
  pickerText:     { color: '#F1F5F9', fontSize: 14 },
  modalCancel:    { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#0F172A', alignItems: 'center' },
  modalCancelText:{ color: '#EF4444', fontWeight: '700' },
  ledgerBox:      { backgroundColor: '#1E293B', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28, maxHeight: '92%' },
  ledgerHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  ledgerName:     { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  ledgerSub:      { color: '#64748B', fontSize: 12, marginTop: 2 },
  closeX:         { color: '#64748B', fontSize: 22 },
  summaryRow:     { flexDirection: 'row', gap: 8, marginBottom: 12 },
  sumBox:         { flex: 1, backgroundColor: '#0F172A', borderRadius: 10, padding: 12, alignItems: 'center' },
  sumLabel:       { color: '#64748B', fontSize: 10, marginBottom: 4 },
  sumVal:         { color: '#F1F5F9', fontSize: 16, fontWeight: 'bold' },
  addEntryBtn:    { backgroundColor: '#F97316', padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 14 },
  addEntryText:   { color: '#fff', fontWeight: '700' },
  entryForm:      { backgroundColor: '#0F172A', borderRadius: 12, padding: 12, marginBottom: 14 },
  ledgerTitle:    { color: '#94A3B8', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  entryRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  typeBadge:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText:  { fontSize: 10, fontWeight: '700' },
  entryRef:       { color: '#F1F5F9', fontSize: 12, fontWeight: '600' },
  entryDate:      { color: '#64748B', fontSize: 11, marginTop: 2 },
  entryAmt:       { fontSize: 13, fontWeight: 'bold' },
  entryBal:       { color: '#64748B', fontSize: 11, marginTop: 2 },
  noData:         { color: '#64748B', textAlign: 'center', paddingVertical: 20 },
});
