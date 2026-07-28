import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { router } from 'expo-router';
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, RefreshControl, Modal,
  Alert, Switch, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending:         { color: '#F59E0B', label: 'Pending' },
  collected:       { color: '#3B82F6', label: 'Collected' },
  received:        { color: '#06B6D4', label: 'Received' },
  tested:          { color: '#F97316', label: 'Tested' },
  validated:       { color: '#A855F7', label: 'Validated' },
  reported:        { color: '#10B981', label: 'Reported' },
  dispatched:      { color: '#8B5CF6', label: 'Dispatched' },
  sample_rejected: { color: '#EF4444', label: 'Rejected' },
};

const STATUS_FLOW = [
  { key: 'collected',  label: '🧪 Collected',  color: '#3B82F6' },
  { key: 'received',   label: '📥 Received',   color: '#06B6D4' },
  { key: 'tested',     label: '🔬 Tested',     color: '#F97316' },
  { key: 'validated',  label: '✅ Validated',  color: '#A855F7' },
  { key: 'reported',   label: '📄 Reported',   color: '#10B981' },
];

interface Patient {
  id: number; barcode: string; patient_name: string;
  age: number; gender: string; doctor_name: string;
  abha_number: string | null; status: string;
  created_at: string; tests_summary: string[]; phone: string | null;
  referral_doctor_id?: number | null;
  registered_franchise_id?: number | null;
  organization_id?: number | null;
  branch_id?: number | null;
  clinical_history?: string | null;
  history_checklist?: Record<string, boolean> | null;
  needs_history?: boolean;
}
interface Doctor { id: number; name: string; }

const todayStr = new Date().toISOString().split('T')[0];

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function isInRange(iso: string, from: string, to: string) {
  const date = iso.split('T')[0];
  return date >= from && date <= to;
}

const BLANK_FORM = {
  patient_name: '', age: '', gender: 'Male',
  referral_doctor_id: null as number | null,
  doctor_name: '',
  phone: '', abha_number: '', barcode: '', note: '',
  checklist: { diabetic: false, on_medication: false, hypertension: false, fasting_sample: false, pregnant: false },
};

// ────────────────────────────────────────────────────────────
export default function FranchisePatients() {
  // The franchise this logged-in user belongs to — auto-applied to every
  // patient, no picker needed (a franchise login only ever registers its
  // own patients).
  const [franchiseId, setFranchiseId] = useState<number | null>(null);

  // List state
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [loading, setLoading]         = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [search, setSearch]           = useState('');
  const [fromDate, setFromDate]       = useState(todayStr);
  const [toDate, setToDate]           = useState(todayStr);
  const [showDateModal, setShowDateModal] = useState(false);
  const [tempFrom, setTempFrom]       = useState(todayStr);
  const [tempTo, setTempTo]           = useState(todayStr);

  // Actions / Change status
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showActions, setShowActions]         = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [statusLoading, setStatusLoading]     = useState(false);
  const [deleting, setDeleting]               = useState(false);

  // Add / Edit Patient
  const [showAddModal, setShowAddModal]   = useState(false);
  const [editingId, setEditingId]         = useState<number | null>(null);
  const [doctors, setDoctors]             = useState<Doctor[]>([]);
  const [doctorSearch, setDoctorSearch]   = useState('');
  const [showDoctorPicker, setShowDoctorPicker] = useState(false);
  const [showAddDoctor, setShowAddDoctor] = useState(false);
  const [newDoctorName, setNewDoctorName] = useState('');
  const [savingDoctor, setSavingDoctor]   = useState(false);
  const [submittingPatient, setSubmittingPatient] = useState(false);

  const [form, setForm] = useState(BLANK_FORM);
  // Inline validation message (age is the only client-side check that
  // applies here — Branch/Franchise are always auto-set for franchise
  // logins, so that check doesn't apply on this portal).
  const [formError, setFormError] = useState<string | null>(null);

  // ── Resolve own franchise
  const fetchFranchise = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() });
      const list = await res.json();
      const mine = Array.isArray(list) ? list[0] : null;
      if (mine) setFranchiseId(mine.id);
    } catch {}
  }, []);

  // ── Fetch patients
  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/patients/`, { headers: authHeader() });
      const data = await res.json();
      setAllPatients(Array.isArray(data) ? data : []);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setLoading(false); }
  }, []);

  // ── Fetch referral doctors
  const fetchDoctors = useCallback(async () => {
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/referral-doctors`, { headers: authHeader() });
      const data = await res.json();
      setDoctors(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchFranchise();
    fetchPatients();
    fetchDoctors();
  }, [fetchFranchise, fetchPatients, fetchDoctors]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPatients();
    setRefreshing(false);
  }, [fetchPatients]);

  // ── Change Status
  const changeStatus = async (newStatus: string) => {
    if (!selectedPatient) return;
    setStatusLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/sample-status/advance`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_ids: [selectedPatient.id], status: newStatus }),
      });
      const data = await res.json();
      if (res.ok && data.updated > 0) {
        setAllPatients(prev => prev.map(p => p.id === selectedPatient.id ? { ...p, status: newStatus } : p));
        setShowStatusModal(false); setShowActions(false);
        Alert.alert('✅ Done', `Status → ${STATUS_CONFIG[newStatus]?.label ?? newStatus}`);
      } else { Alert.alert('Error', 'Status change failed'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setStatusLoading(false); }
  };

  const rejectSample = () => Alert.alert('⚠️ Reject Sample', `Reject ${selectedPatient?.patient_name}?`,
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => changeStatus('sample_rejected') }]
  );

  const [reportLoading, setReportLoading] = useState(false);

  // View/Share Report
  const viewReport = async (p: Patient) => {
    setReportLoading(true);
    try {
      const tok = getToken();
      const res = await fetch(`${API_BASE}/api/results/?barcode=${encodeURIComponent(p.barcode)}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const results = await res.json();
      const list = Array.isArray(results) ? results : [];
      if (list.length === 0) { Alert.alert('No Report', 'No report found for this patient yet.'); return; }
      const reported = list.find((r: any) => r.lifecycle_status === 'reported') ?? list[0];
      const fileUri = FileSystem.cacheDirectory + `Report_${p.barcode}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/results/${reported.id}/pdf`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Report not ready or not accessible.'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Report ${p.barcode}` });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) {
      Alert.alert('Error', 'Report failed: ' + e.message);
    } finally { setReportLoading(false); setShowActions(false); }
  };

  // View Bill
  const viewBill = async (p: Patient) => {
    setReportLoading(true);
    try {
      const tok = getToken();
      const res = await fetch(`${API_BASE}/api/billing/bills?barcode=${encodeURIComponent(p.barcode)}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const bills = await res.json();
      const list = Array.isArray(bills) ? bills : (bills.items ?? []);
      if (list.length === 0) { Alert.alert('No Bill', 'No bill found for this patient.'); return; }
      const bill = list[0];
      const fileUri = FileSystem.cacheDirectory + `Receipt_${bill.bill_no}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/billing/bills/${bill.id}/receipt`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Receipt not accessible.'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Bill ${bill.bill_no}` });
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setReportLoading(false); setShowActions(false); }
  };

  // Create Bill — jump straight to New Bill with this patient pre-selected
  const createBill = (p: Patient) => {
    setShowActions(false);
    router.navigate({ pathname: '/(franchise)/new-bill', params: { patient_id: String(p.id) } } as any);
  };

  // Delete (archive) patient
  const deletePatient = (p: Patient) => {
    Alert.alert('Delete Patient', `Archive ${p.patient_name}? This can't be undone from here.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            const res  = await fetch(`${API_BASE}/api/patients/${p.id}`, { method: 'DELETE', headers: authHeader() });
            const data = await res.json();
            if (res.ok) {
              setAllPatients(prev => prev.filter(x => x.id !== p.id));
              setShowActions(false);
              Alert.alert('✅ Archived', data.message ?? 'Patient archived');
            } else { Alert.alert('Error', 'Could not delete patient'); }
          } catch (e: any) { Alert.alert('Error', e.message); }
          finally { setDeleting(false); }
        },
      },
    ]);
  };

  // ── Add Doctor
  const saveNewDoctor = async () => {
    if (!newDoctorName.trim()) return;
    setSavingDoctor(true);
    try {
      const res  = await fetch(`${API_BASE}/api/b2b/referral-doctors`, {
        method: 'POST',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newDoctorName.trim(), phone: '', commission_percent: 0 }),
      });
      const data = await res.json();
      if (res.ok) {
        setDoctors(prev => [...prev, data]);
        setForm(f => ({ ...f, referral_doctor_id: data.id, doctor_name: data.name }));
        setNewDoctorName(''); setShowAddDoctor(false);
      } else { Alert.alert('Error', 'Could not add doctor'); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSavingDoctor(false); }
  };

  // ── Register / Update Patient
  const submitPatient = async (andBill = false) => {
    if (!form.patient_name.trim()) { Alert.alert('Error', 'Patient name is required'); return; }
    if (!form.age.trim()) { setFormError('Age is required.'); return; }
    setFormError(null);
    setSubmittingPatient(true);
    const isEdit = editingId != null;
    try {
      const payload: any = {
        patient_name: form.patient_name.trim(),
        age: form.age ? parseInt(form.age) : null,
        gender: form.gender,
        doctor_name: form.doctor_name || null,
        referral_doctor_id: form.referral_doctor_id,
        checklist: form.checklist,
        note: form.note || null,
        abha_number: form.abha_number || null,
        phone: form.phone || null,
        branch_id: null,
        registered_franchise_id: franchiseId,
        organization_id: franchiseId,
      };
      if (!isEdit) payload.barcode = form.barcode || undefined;

      const url    = isEdit ? `${API_BASE}/api/patients/${editingId}` : `${API_BASE}/api/patients/`;
      const method = isEdit ? 'PUT' : 'POST';
      const res  = await fetch(url, {
        method, headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAddModal(false);
        setEditingId(null);
        setForm(BLANK_FORM);
        fetchPatients();
        if (!isEdit && andBill) {
          router.navigate({ pathname: '/(franchise)/new-bill', params: { patient_id: String(data.id) } } as any);
        } else {
          Alert.alert(isEdit ? '✅ Updated' : '✅ Registered', `${data.patient_name}${!isEdit ? `\nBarcode: ${data.barcode}` : ''}`);
        }
      } else { Alert.alert('Error', JSON.stringify(data)); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSubmittingPatient(false); }
  };

  const openAddPatient = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
    setFormError(null);
    setShowAddModal(true);
  };

  const openEditPatient = (p: Patient) => {
    setEditingId(p.id);
    setForm({
      patient_name: p.patient_name ?? '',
      age: p.age != null ? String(p.age) : '',
      gender: p.gender || 'Male',
      referral_doctor_id: p.referral_doctor_id ?? null,
      doctor_name: p.doctor_name || '',
      phone: p.phone || '',
      abha_number: p.abha_number || '',
      barcode: p.barcode || '',
      note: p.clinical_history || '',
      checklist: {
        diabetic:       p.history_checklist?.diabetic ?? false,
        on_medication:  p.history_checklist?.on_medication ?? false,
        hypertension:   p.history_checklist?.hypertension ?? false,
        fasting_sample: p.history_checklist?.fasting_sample ?? false,
        pregnant:       p.history_checklist?.pregnant ?? false,
      },
    });
    setShowActions(false);
    setFormError(null);
    setShowAddModal(true);
  };

  // ── Filtered list
  const filtered = allPatients
    .filter(p => isInRange(p.created_at, fromDate, toDate))
    .filter(p =>
      p.patient_name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.toLowerCase().includes(search.toLowerCase())
    );

  const filteredDoctors = doctors.filter(d => d.name.toLowerCase().includes(doctorSearch.toLowerCase()));

  const renderPatient = ({ item: p }: { item: Patient }) => {
    const cfg = STATUS_CONFIG[p.status] ?? { color: '#64748B', label: p.status };
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <Text style={styles.barcode}>📋 {p.barcode}</Text>
          <View style={[styles.statusBadge, { borderColor: cfg.color }]}>
            <Text style={[styles.statusText, { color: cfg.color }]}>● {cfg.label}</Text>
          </View>
        </View>
        <Text style={styles.patientName}>{p.patient_name}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>👤 {p.age}y / {p.gender}</Text>
          <Text style={styles.dot}>·</Text>
          <Text style={styles.meta}>🩺 {p.doctor_name}</Text>
          {p.abha_number && <><Text style={styles.dot}>·</Text><Text style={[styles.meta, { color: '#10B981' }]}>ABHA ✓</Text></>}
        </View>
        <View style={styles.testsRow}>
          {(p.tests_summary ?? []).map((t, i) => <View key={i} style={styles.testChip}><Text style={styles.testChipText}>{t}</Text></View>)}
        </View>
        <View style={styles.cardFooter}>
          <Text style={styles.registered}>🕐 {formatDate(p.created_at)}</Text>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setSelectedPatient(p); setShowActions(true); }}>
            <Text style={styles.actionBtnText}>Actions ▾</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // ════════════════════════════════════════════════════
  return (
    <View style={styles.container}>
      {/* Search */}
      <View style={styles.searchWrap}>
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch}
          placeholder="🔍  Search by name or barcode..." placeholderTextColor="#475569" />
      </View>

      {/* Date bar */}
      <View style={styles.dateBar}>
        <Text style={styles.dateText} numberOfLines={1}>
          📅 {fromDate === todayStr && toDate === todayStr ? 'Today'
            : fromDate === '2020-01-01' ? 'All Patients' : `${fromDate} → ${toDate}`}
        </Text>
        <TouchableOpacity style={styles.pill} onPress={() => { setTempFrom(fromDate); setTempTo(toDate); setShowDateModal(true); }}>
          <Text style={styles.pillText}>Range</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pill, styles.pillActive]} onPress={() => { setFromDate(todayStr); setToDate(todayStr); }}>
          <Text style={[styles.pillText, { color: '#fff' }]}>Today</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.pill, { borderColor: '#8B5CF6' }]} onPress={() => { setFromDate('2020-01-01'); setToDate(todayStr); }}>
          <Text style={[styles.pillText, { color: '#8B5CF6' }]}>All</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.countText}>{filtered.length} patient{filtered.length !== 1 ? 's' : ''}</Text>

      {/* List */}
      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={filtered} keyExtractor={p => p.id.toString()} renderItem={renderPatient}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" colors={['#17B9A1']} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>No patients found</Text>
              <Text style={styles.emptySubText}>Tap "All" to see all patients</Text>
            </View>
          }
        />
      )}

      {/* FAB — Add Patient */}
      <TouchableOpacity style={styles.fab} onPress={openAddPatient}>
        <Text style={styles.fabText}>+ Add Patient</Text>
      </TouchableOpacity>

      {/* ── Date range modal ── */}
      <Modal visible={showDateModal} transparent animationType="slide" onRequestClose={() => setShowDateModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>📅 Date Range</Text>
            <Text style={styles.modalLabel}>From (YYYY-MM-DD)</Text>
            <TextInput style={styles.modalInput} value={tempFrom} onChangeText={setTempFrom} placeholderTextColor="#475569" />
            <Text style={styles.modalLabel}>To (YYYY-MM-DD)</Text>
            <TextInput style={styles.modalInput} value={tempTo} onChangeText={setTempTo} placeholderTextColor="#475569" />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowDateModal(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.applyBtn} onPress={() => { setFromDate(tempFrom); setToDate(tempTo); setShowDateModal(false); }}>
                <Text style={styles.applyText}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Actions bottom sheet ── */}
      <Modal visible={showActions} transparent animationType="slide" onRequestClose={() => setShowActions(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowActions(false)}>
          <View style={styles.actionsSheet}>
            <Text style={styles.actionsName}>{selectedPatient?.patient_name}</Text>
            <View style={styles.actionsMetaRow}>
              <Text style={styles.actionsBarcode}>{selectedPatient?.barcode}</Text>
              {selectedPatient && (
                <View style={[styles.statusBadge, { borderColor: STATUS_CONFIG[selectedPatient.status]?.color ?? '#64748B' }]}>
                  <Text style={[styles.statusText, { color: STATUS_CONFIG[selectedPatient.status]?.color ?? '#64748B' }]}>
                    ● {STATUS_CONFIG[selectedPatient.status]?.label ?? selectedPatient.status}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity style={styles.actionItem}
              onPress={() => selectedPatient && viewReport(selectedPatient)} disabled={reportLoading}>
              <Text style={styles.actionIcon}>📄</Text>
              <Text style={styles.actionLabel}>View / Share Report</Text>
              {reportLoading ? <ActivityIndicator color="#17B9A1" size="small" /> : <Text style={styles.actionArrow}>›</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem}
              onPress={() => selectedPatient && viewBill(selectedPatient)} disabled={reportLoading}>
              <Text style={styles.actionIcon}>💳</Text>
              <Text style={styles.actionLabel}>View / Share Bill</Text>
              <Text style={styles.actionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionItem}
              onPress={() => selectedPatient && createBill(selectedPatient)}>
              <Text style={styles.actionIcon}>🧾</Text>
              <Text style={[styles.actionLabel, { color: '#F97316' }]}>Create Bill</Text>
              <Text style={styles.actionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.actionItem, { borderBottomWidth: 0 }]}
              onPress={() => selectedPatient && openEditPatient(selectedPatient)}>
              <Text style={styles.actionIcon}>✏️</Text>
              <Text style={[styles.actionLabel, { color: '#17B9A1' }]}>Edit</Text>
              <Text style={styles.actionArrow}>›</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteItem}
              onPress={() => selectedPatient && deletePatient(selectedPatient)} disabled={deleting}>
              {deleting ? <ActivityIndicator color="#EF4444" size="small" /> : <Text style={styles.deleteItemText}>🗑  Delete Patient</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowActions(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── Change Status modal ── */}
      <Modal visible={showStatusModal} transparent animationType="slide" onRequestClose={() => setShowStatusModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.statusSheet}>
            <Text style={styles.modalTitle}>🔄 Change Status</Text>
            <Text style={styles.actionsName}>{selectedPatient?.patient_name}</Text>
            <Text style={styles.actionsBarcode}>{selectedPatient?.barcode}</Text>
            <Text style={[styles.modalLabel, { marginTop: 12 }]}>Current:</Text>
            {selectedPatient && (
              <View style={[styles.statusBadge, { alignSelf: 'flex-start', marginBottom: 16, borderColor: STATUS_CONFIG[selectedPatient.status]?.color ?? '#64748B' }]}>
                <Text style={[styles.statusText, { color: STATUS_CONFIG[selectedPatient.status]?.color ?? '#64748B' }]}>
                  ● {STATUS_CONFIG[selectedPatient.status]?.label ?? selectedPatient.status}
                </Text>
              </View>
            )}
            <Text style={styles.modalLabel}>Advance to:</Text>
            <View style={{ gap: 8 }}>
              {STATUS_FLOW.map(s => (
                <TouchableOpacity key={s.key} style={[styles.statusOption, { borderColor: s.color }]}
                  onPress={() => changeStatus(s.key)} disabled={statusLoading}>
                  <Text style={[styles.statusOptionText, { color: s.color }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {statusLoading && <ActivityIndicator color="#17B9A1" style={{ marginVertical: 12 }} />}
            <TouchableOpacity style={styles.rejectBtn} onPress={rejectSample} disabled={statusLoading}>
              <Text style={styles.rejectBtnText}>⚠️  Reject Sample</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} onPress={() => setShowStatusModal(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── ADD / EDIT PATIENT full-screen modal ── */}
      <Modal visible={showAddModal} animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.addModalHeader}>
            <TouchableOpacity onPress={() => { setShowAddModal(false); setEditingId(null); }}>
              <Text style={styles.addModalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.addModalTitle}>{editingId != null ? 'Edit Patient' : 'Register New Patient'}</Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView style={styles.addModalBody} keyboardShouldPersistTaps="handled">

            {/* Name */}
            <Text style={styles.fieldLabel}>Patient Name *</Text>
            <TextInput style={styles.fieldInput} value={form.patient_name}
              onChangeText={v => setForm(f => ({ ...f, patient_name: v }))}
              placeholder="Full name" placeholderTextColor="#475569" />

            {/* Age + Gender row */}
            <View style={styles.rowFields}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Age *</Text>
                <TextInput style={styles.fieldInput} value={form.age}
                  onChangeText={v => { setForm(f => ({ ...f, age: v })); if (formError) setFormError(null); }}
                  placeholder="35" placeholderTextColor="#475569" keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.genderRow}>
                  {['Male', 'Female', 'Other'].map(g => (
                    <TouchableOpacity key={g} style={[styles.genderBtn, form.gender === g && styles.genderBtnActive]}
                      onPress={() => setForm(f => ({ ...f, gender: g }))}>
                      <Text style={[styles.genderText, form.gender === g && { color: '#fff' }]}>{g[0]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {formError && (
              <View style={styles.formErrorBox}>
                <Text style={styles.formErrorText}>⚠️ {formError}</Text>
              </View>
            )}

            {/* Doctor */}
            <Text style={styles.fieldLabel}>Referral Doctor</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[styles.fieldInput, { flex: 1, justifyContent: 'center' }]}
                onPress={() => { setDoctorSearch(''); setShowDoctorPicker(true); }}>
                <Text style={form.doctor_name ? styles.fieldInputText : { color: '#475569' }}>
                  {form.doctor_name || '-- Select doctor --'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addDoctorBtn} onPress={() => setShowAddDoctor(true)}>
                <Text style={styles.addDoctorBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            {/* Phone */}
            <Text style={styles.fieldLabel}>Phone</Text>
            <TextInput style={styles.fieldInput} value={form.phone}
              onChangeText={v => setForm(f => ({ ...f, phone: v }))}
              placeholder="10-digit mobile" placeholderTextColor="#475569" keyboardType="phone-pad" />

            {/* ABHA */}
            <Text style={styles.fieldLabel}>ABHA Number (14-digit health ID)</Text>
            <TextInput style={styles.fieldInput} value={form.abha_number}
              onChangeText={v => setForm(f => ({ ...f, abha_number: v }))}
              placeholder="91-1234-5678-9012" placeholderTextColor="#475569" />

            {/* Barcode — auto-generated only on new registration (matches web: HC + 5 digits);
                shown read-only with the real value once a patient already exists */}
            <Text style={styles.fieldLabel}>
              Barcode {editingId != null ? '(locked after registration)' : '(auto-generated · HC + 5 digits)'}
            </Text>
            {editingId != null ? (
              <View style={[styles.fieldInput, { justifyContent: 'center', opacity: 0.5 }]}>
                <Text style={{ color: '#0F172A', fontSize: 14 }}>{form.barcode}</Text>
              </View>
            ) : (
              <View style={[styles.fieldInput, { justifyContent: 'center', opacity: 0.6 }]}>
                <Text style={{ color: '#64748B', fontSize: 14 }}>Assigned automatically on save</Text>
              </View>
            )}

            {/* Patient History */}
            <Text style={[styles.fieldLabel, { color: '#F59E0B', marginTop: 8 }]}>Patient History</Text>
            <View style={styles.checklistCard}>
              {([
                ['diabetic',      'Diabetic?'],
                ['on_medication', 'On medication?'],
                ['hypertension',  'Hypertension?'],
                ['fasting_sample','Fasting sample?'],
                ['pregnant',      'Pregnant?'],
              ] as [keyof typeof form.checklist, string][]).map(([key, label]) => (
                <View key={key} style={styles.checkRow}>
                  <Text style={styles.checkLabel}>{label}</Text>
                  <Switch value={form.checklist[key]}
                    onValueChange={v => setForm(f => ({ ...f, checklist: { ...f.checklist, [key]: v } }))}
                    trackColor={{ false: '#E2E8F0', true: '#F59E0B' }} thumbColor="#fff" />
                </View>
              ))}
            </View>

            {/* Note */}
            <Text style={styles.fieldLabel}>Note (optional)</Text>
            <TextInput style={[styles.fieldInput, { height: 80, textAlignVertical: 'top' }]}
              value={form.note} onChangeText={v => setForm(f => ({ ...f, note: v }))}
              placeholder="e.g. Confirm last meal time..." placeholderTextColor="#475569" multiline />

            {/* Buttons */}
            {editingId != null ? (
              <TouchableOpacity style={[styles.regBtn, { backgroundColor: '#17B9A1', marginTop: 24 }]}
                onPress={() => submitPatient(false)} disabled={submittingPatient}>
                {submittingPatient ? <ActivityIndicator color="#fff" /> : <Text style={styles.regBtnText}>Save Changes</Text>}
              </TouchableOpacity>
            ) : (
              <View style={styles.regBtns}>
                <TouchableOpacity style={[styles.regBtn, { backgroundColor: '#F59E0B' }]}
                  onPress={() => submitPatient(false)} disabled={submittingPatient}>
                  {submittingPatient ? <ActivityIndicator color="#fff" /> : <Text style={styles.regBtnText}>Register Only</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.regBtn, { backgroundColor: '#10B981' }]}
                  onPress={() => submitPatient(true)} disabled={submittingPatient}>
                  <Text style={styles.regBtnText}>Register & Bill →</Text>
                </TouchableOpacity>
              </View>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Doctor picker modal */}
        <Modal visible={showDoctorPicker} transparent animationType="slide" onRequestClose={() => setShowDoctorPicker(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>Select Doctor</Text>
              <TextInput style={styles.modalInput} value={doctorSearch} onChangeText={setDoctorSearch}
                placeholder="Search doctors..." placeholderTextColor="#475569" autoFocus />
              <ScrollView style={{ maxHeight: 340 }}>
                <TouchableOpacity style={styles.patItem}
                  onPress={() => { setForm(f => ({ ...f, referral_doctor_id: null, doctor_name: '' })); setShowDoctorPicker(false); }}>
                  <Text style={{ color: '#475569', fontSize: 14 }}>-- None --</Text>
                </TouchableOpacity>
                {filteredDoctors.map(d => (
                  <TouchableOpacity key={d.id} style={[styles.patItem, form.referral_doctor_id === d.id && styles.patItemSel]}
                    onPress={() => { setForm(f => ({ ...f, referral_doctor_id: d.id, doctor_name: d.name })); setShowDoctorPicker(false); }}>
                    <Text style={styles.patName}>{d.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDoctorPicker(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* Add Doctor modal */}
        <Modal visible={showAddDoctor} transparent animationType="slide" onRequestClose={() => setShowAddDoctor(false)}>
          <View style={styles.overlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>➕ Add Referral Doctor</Text>
              <Text style={[styles.modalLabel, { marginBottom: 12 }]}>
                Just a name — no login needed. Set commission % later in Doctors master.
              </Text>
              <Text style={styles.fieldLabel}>Doctor Name *</Text>
              <TextInput style={styles.modalInput} value={newDoctorName} onChangeText={setNewDoctorName}
                placeholder="Dr. Name" placeholderTextColor="#475569" autoFocus />
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowAddDoctor(false); setNewDoctorName(''); }}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.applyBtn} onPress={saveNewDoctor} disabled={savingDoctor}>
                  {savingDoctor ? <ActivityIndicator color="#fff" /> : <Text style={styles.applyText}>Add Doctor</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </Modal>
    </View>
  );
}

// ────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#F8FAFC' },
  searchWrap:       { padding: 12, paddingBottom: 8 },
  searchInput:      { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  dateBar:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 6 },
  dateText:         { flex: 1, color: '#94A3B8', fontSize: 12 },
  pill:             { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' },
  pillActive:       { backgroundColor: '#F97316', borderColor: '#F97316' },
  pillText:         { color: '#94A3B8', fontSize: 11, fontWeight: '600' },
  countText:        { color: '#475569', fontSize: 12, paddingHorizontal: 12, marginBottom: 4 },
  card:             { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  cardRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barcode:          { color: '#64748B', fontSize: 12 },
  statusBadge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  statusText:       { fontSize: 11, fontWeight: '700' },
  patientName:      { color: '#0F172A', fontSize: 16, fontWeight: 'bold', marginBottom: 6 },
  metaRow:          { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginBottom: 8 },
  meta:             { color: '#64748B', fontSize: 12 },
  dot:              { color: '#E2E8F0', fontSize: 12 },
  testsRow:         { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  testChip:         { backgroundColor: '#F8FAFC', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: '#1E40AF' },
  testChipText:     { color: '#60A5FA', fontSize: 11 },
  cardFooter:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  registered:       { color: '#475569', fontSize: 11 },
  actionBtn:        { backgroundColor: '#F97316', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  actionBtnText:    { color: '#fff', fontSize: 12, fontWeight: '700' },
  fab:              { position: 'absolute', bottom: 20, right: 20, backgroundColor: '#F97316', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, elevation: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 6 },
  fabText:          { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  empty:            { alignItems: 'center', marginTop: 60 },
  emptyIcon:        { fontSize: 48 },
  emptyText:        { color: '#475569', fontSize: 16, marginTop: 12 },
  emptySubText:     { color: '#E2E8F0', fontSize: 13, marginTop: 6 },
  overlay:          { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:         { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle:       { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  modalLabel:       { color: '#94A3B8', fontSize: 13, marginBottom: 6 },
  modalInput:       { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
  modalBtns:        { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn:        { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  cancelText:       { color: '#94A3B8', fontWeight: '600' },
  applyBtn:         { flex: 1, padding: 14, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  applyText:        { color: '#fff', fontWeight: '700' },
  actionsSheet:     { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  actionsMetaRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  actionsName:      { color: '#0F172A', fontSize: 16, fontWeight: 'bold' },
  actionsBarcode:   { color: '#64748B', fontSize: 12, marginBottom: 4 },
  actionItem:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  actionIcon:       { fontSize: 20, marginRight: 14, width: 28 },
  actionLabel:      { flex: 1, color: '#0F172A', fontSize: 15 },
  actionArrow:      { color: '#475569', fontSize: 20 },
  deleteItem:       { paddingVertical: 14, alignItems: 'center' },
  deleteItemText:   { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  sheetCancel:      { marginTop: 4, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  sheetCancelText:  { color: '#94A3B8', fontWeight: '700' },
  statusSheet:      { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
  statusOption:     { padding: 14, borderRadius: 10, borderWidth: 1.5, alignItems: 'center' },
  statusOptionText: { fontSize: 15, fontWeight: '600' },
  rejectBtn:        { marginTop: 14, padding: 14, borderRadius: 10, backgroundColor: '#7F1D1D', borderWidth: 1, borderColor: '#EF4444', alignItems: 'center' },
  rejectBtnText:    { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  // Add / Edit Patient modal
  addModalHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', paddingTop: 50 },
  addModalClose:    { color: '#94A3B8', fontSize: 20, padding: 4 },
  addModalTitle:    { color: '#0F172A', fontSize: 16, fontWeight: 'bold' },
  addModalBody:     { flex: 1, backgroundColor: '#F8FAFC', padding: 16 },
  fieldLabel:       { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 14 },
  formErrorBox:     { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 8, padding: 10, marginTop: 14 },
  formErrorText:    { color: '#DC2626', fontSize: 12, fontWeight: '600' },
  fieldInput:       { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  fieldInputText:   { color: '#0F172A', fontSize: 14 },
  rowFields:        { flexDirection: 'row', gap: 12 },
  genderRow:        { flexDirection: 'row', gap: 6 },
  genderBtn:        { flex: 1, padding: 11, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', alignItems: 'center' },
  genderBtnActive:  { backgroundColor: '#F97316', borderColor: '#F97316' },
  genderText:       { color: '#94A3B8', fontWeight: '600' },
  addDoctorBtn:     { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, width: 46, alignItems: 'center', justifyContent: 'center' },
  addDoctorBtnText: { color: '#F97316', fontSize: 22, fontWeight: 'bold' },
  checklistCard:    { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  checkRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  checkLabel:       { color: '#0F172A', fontSize: 14 },
  regBtns:          { flexDirection: 'row', gap: 12, marginTop: 24 },
  regBtn:           { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },
  regBtnText:       { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  // Shared
  patItem:          { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  patItemSel:       { borderColor: '#F97316', backgroundColor: '#F9731615' },
  patName:          { color: '#0F172A', fontSize: 14, fontWeight: '600' },
  modalCancel:      { marginTop: 12, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText:  { color: '#EF4444', fontWeight: '700' },
});
