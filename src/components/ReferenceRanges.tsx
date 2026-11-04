/**
 * Reference Ranges — the phone's version of the web's third Tests Catalog tab.
 *
 * These rows decide the range printed on a report and whether a value reads
 * HIGH or LOW. A row with no test applies wherever that parameter is reported;
 * one naming a test overrides it. Where several could apply, the age band wins
 * first, then sex, then the test. A row with a method but no range sets only
 * the methodology.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  TextInput, Alert, Modal, ScrollView,
} from 'react-native';
import { authHeader, API_BASE } from '../utils/auth';

export interface Range {
  id: number;
  test_id: number | null;
  param: string | null;
  sex: string | null;                 // 'A' | 'M' | 'F' | 'C'
  age_min: number | null;  age_max: number | null;
  age_min_months: number | null; age_max_months: number | null;
  low: number | null; high: number | null;
  critical_low: number | null; critical_high: number | null;
  unit: string | null; text: string | null;
  method: string | null; device_id: number | null;
}
interface NamedId { id: number; name: string; }

// Matches the web: 'C' is a label for an age-banded row, not a sex of its own.
const GROUP_LABEL: Record<string, string> = { A: 'Any', M: 'Male', F: 'Female', C: 'Children' };
const GROUPS: [string, string][] = [['A','Any'], ['M','Male'], ['F','Female'], ['C','Children']];

const BLANK = {
  id: null as number | null,
  param: '', test_id: null as number | null, sex: 'A',
  age_min: '', age_max: '', age_min_months: '', age_max_months: '',
  low: '', high: '', critical_low: '', critical_high: '',
  unit: '', text: '', method: '', device_id: null as number | null,
};

const num = (v: string) => { const s = (v ?? '').trim(); return s === '' ? null : Number(s); };

export default function ReferenceRanges({ tests }: { tests: NamedId[] }) {
  const [rows, setRows]       = useState<Range[]>([]);
  const [devices, setDevices] = useState<NamedId[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [form, setForm]       = useState<typeof BLANK | null>(null);
  const [saving, setSaving]   = useState(false);
  const [showTestPicker, setShowTestPicker]     = useState(false);
  const [showDevicePicker, setShowDevicePicker] = useState(false);

  const load = useCallback(() => {
    fetch(`${API_BASE}/api/catalog/reference-ranges`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setRows(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetch(`${API_BASE}/api/devices/`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : [])
      .then(d => setDevices(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, [load]);

  const testName   = (id: number | null) => tests.find(t => t.id === id)?.name || null;
  const deviceName = (id: number | null) => devices.find(d => d.id === id)?.name || (id ? `Device #${id}` : null);

  const ageText = (r: Range) => {
    if (r.age_min_months != null || r.age_max_months != null)
      return `${r.age_min_months ?? 0}–${r.age_max_months ?? '∞'} mo`;
    if (r.age_min != null || r.age_max != null)
      return `${r.age_min ?? 0}–${r.age_max ?? '∞'} yr`;
    return 'Any age';
  };
  const rangeText = (r: Range) => {
    if (r.text) return r.text;
    if (r.low == null && r.high == null) return '—';
    return `${r.low ?? '—'} – ${r.high ?? '—'}`;
  };

  // grouped by parameter, exactly like the web page
  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter(r => (r.param || '').toLowerCase().includes(q)
                    || (testName(r.test_id) || '').toLowerCase().includes(q))
    : rows;
  const groups: { key: string; rows: Range[] }[] = [];
  shown.forEach(r => {
    const key = (r.param || '').toUpperCase();
    let g = groups.find(x => x.key === key);
    if (!g) { g = { key, rows: [] }; groups.push(g); }
    g.rows.push(r);
  });
  groups.sort((a, b) => a.key.localeCompare(b.key));

  const openNew  = () => setForm({ ...BLANK });
  const openEdit = (r: Range) => setForm({
    id: r.id, param: r.param || '', test_id: r.test_id, sex: (r.sex || 'A').toUpperCase(),
    age_min: r.age_min?.toString() ?? '', age_max: r.age_max?.toString() ?? '',
    age_min_months: r.age_min_months?.toString() ?? '', age_max_months: r.age_max_months?.toString() ?? '',
    low: r.low?.toString() ?? '', high: r.high?.toString() ?? '',
    critical_low: r.critical_low?.toString() ?? '', critical_high: r.critical_high?.toString() ?? '',
    unit: r.unit || '', text: r.text || '', method: r.method || '', device_id: r.device_id,
  });

  const save = async () => {
    if (!form) return;
    if (!form.param.trim()) { Alert.alert('Parameter required', 'Type it exactly as the analyser reports it.'); return; }
    setSaving(true);
    const payload = {
      param: form.param.trim(), test_id: form.test_id, sex: form.sex,
      age_min: num(form.age_min), age_max: num(form.age_max),
      age_min_months: num(form.age_min_months), age_max_months: num(form.age_max_months),
      low: num(form.low), high: num(form.high),
      critical_low: num(form.critical_low), critical_high: num(form.critical_high),
      unit: form.unit.trim() || null, text: form.text.trim() || null,
      method: form.method.trim() || null, device_id: form.device_id,
    };
    try {
      const res = await fetch(
        form.id ? `${API_BASE}/api/catalog/reference-ranges/${form.id}` : `${API_BASE}/api/catalog/reference-ranges`,
        { method: form.id ? 'PUT' : 'POST',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setForm(null); load();
    } catch {
      Alert.alert('Could not save', 'The range was not saved. Check the values and try again.');
    }
    setSaving(false);
  };

  const remove = (r: Range) => {
    Alert.alert('Delete this range?',
      `${r.param} · ${GROUP_LABEL[(r.sex || 'A').toUpperCase()]} · ${ageText(r)}\n\n` +
      'Reports will fall back to the next range that fits, or to whatever the analyser sent.',
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Delete', style: 'destructive', onPress: async () => {
          try {
            const res = await fetch(`${API_BASE}/api/catalog/reference-ranges/${r.id}`,
              { method: 'DELETE', headers: authHeader() });
            if (!res.ok) throw new Error();
            load();
          } catch { Alert.alert('Could not delete', 'The range is still there.'); }
       } }]);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#F97316" size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity style={styles.addBtn} onPress={openNew}>
        <Text style={styles.addBtnText}>+ Add Range</Text>
      </TouchableOpacity>

      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="🔍  Search parameter or test..." placeholderTextColor="#475569" />
      </View>

      <FlatList
        data={groups}
        keyExtractor={g => g.key}
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={styles.note}>
            <Text style={styles.noteText}>
              These decide the range printed on the report, and whether a value reads HIGH or LOW.
              Where several could apply, the one matching the patient's age wins, then sex, then test.
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📏</Text>
            <Text style={styles.emptyText}>
              {rows.length === 0 ? 'No reference ranges yet' : 'Nothing matches that search'}
            </Text>
          </View>
        }
        renderItem={({ item: g }) => (
          <View style={styles.card}>
            <Text style={styles.paramName}>
              {g.key} <Text style={styles.paramCount}>· {g.rows.length} range{g.rows.length > 1 ? 's' : ''}</Text>
            </Text>
            {g.rows.map(r => (
              <View key={r.id} style={styles.rangeRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.chipRow}>
                    <Text style={styles.chip}>{GROUP_LABEL[(r.sex || 'A').toUpperCase()] || r.sex}</Text>
                    <Text style={styles.chipMuted}>{ageText(r)}</Text>
                    {r.test_id != null && <Text style={styles.chipTest}>{testName(r.test_id) || `Test #${r.test_id}`}</Text>}
                  </View>
                  <Text style={styles.rangeText}>{rangeText(r)} {r.unit || ''}</Text>
                  {(r.critical_low != null || r.critical_high != null) && (
                    <Text style={styles.critical}>Critical {r.critical_low ?? '—'} / {r.critical_high ?? '—'}</Text>
                  )}
                  {!!r.method && (
                    <Text style={styles.method}>
                      {r.method}{r.device_id ? ` · ${deviceName(r.device_id)}` : ''}
                    </Text>
                  )}
                </View>
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(r)}><Text>✏️</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.iconBtn} onPress={() => remove(r)}><Text>🗑️</Text></TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      />

      {/* add / edit */}
      <Modal visible={!!form} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <View style={styles.overlay}>
          <View style={styles.formBox}>
            <Text style={styles.modalTitle}>{form?.id ? 'Edit reference range' : 'Add reference range'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Parameter *</Text>
              <TextInput style={styles.input} value={form?.param} autoCapitalize="characters"
                onChangeText={v => setForm(f => f && ({ ...f, param: v }))}
                placeholder="HGB, WBC, NEUT%, TSH II…" placeholderTextColor="#94A3B8" />
              <Text style={styles.fieldHint}>Exactly as the analyser reports it. Capitals don't matter.</Text>

              <Text style={styles.fieldLabel}>Applies to</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowTestPicker(true)}>
                <Text style={{ color: '#0F172A', fontSize: 13 }}>
                  {form?.test_id ? (testName(form.test_id) || `Test #${form.test_id}`) : 'All tests reporting this parameter'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Patient group</Text>
              <View style={styles.segRow}>
                {GROUPS.map(([v, label]) => (
                  <TouchableOpacity key={v}
                    style={[styles.seg, form?.sex === v && styles.segActive]}
                    onPress={() => setForm(f => f && ({ ...f, sex: v }))}>
                    <Text style={[styles.segText, form?.sex === v && styles.segTextActive]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {form?.sex === 'C' && (
                <Text style={styles.fieldHint}>
                  Children applies to any sex — set the age band below to say which ages it covers.
                </Text>
              )}

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Age from (years)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.age_min}
                    onChangeText={v => setForm(f => f && ({ ...f, age_min: v }))} placeholder="any" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Age to (years)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.age_max}
                    onChangeText={v => setForm(f => f && ({ ...f, age_max: v }))} placeholder="any" placeholderTextColor="#94A3B8" />
                </View>
              </View>

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Age from (months)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.age_min_months}
                    onChangeText={v => setForm(f => f && ({ ...f, age_min_months: v }))} placeholder="—" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Age to (months)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.age_max_months}
                    onChangeText={v => setForm(f => f && ({ ...f, age_max_months: v }))} placeholder="—" placeholderTextColor="#94A3B8" />
                </View>
              </View>
              <Text style={styles.fieldHint}>
                For infants. Patient registration records age in whole years, so a month band will not
                match anyone until age in months is captured — leave these blank and use the year fields.
              </Text>

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Low</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.low}
                    onChangeText={v => setForm(f => f && ({ ...f, low: v }))} placeholder="e.g. 12" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>High</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.high}
                    onChangeText={v => setForm(f => f && ({ ...f, high: v }))} placeholder="e.g. 15" placeholderTextColor="#94A3B8" />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Unit</Text>
              <TextInput style={styles.input} value={form?.unit}
                onChangeText={v => setForm(f => f && ({ ...f, unit: v }))}
                placeholder="keep analyser's" placeholderTextColor="#94A3B8" />

              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Critical low</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.critical_low}
                    onChangeText={v => setForm(f => f && ({ ...f, critical_low: v }))} placeholder="optional" placeholderTextColor="#94A3B8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Critical high</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={form?.critical_high}
                    onChangeText={v => setForm(f => f && ({ ...f, critical_high: v }))} placeholder="optional" placeholderTextColor="#94A3B8" />
                </View>
              </View>

              <Text style={styles.fieldLabel}>Method (optional)</Text>
              <TextInput style={styles.input} value={form?.method}
                onChangeText={v => setForm(f => f && ({ ...f, method: v }))}
                placeholder='e.g. "Impedance"' placeholderTextColor="#94A3B8" />
              <Text style={styles.fieldHint}>Printed under METHODOLOGY. Leave the range blank to set only the method.</Text>

              <Text style={styles.fieldLabel}>Analyser</Text>
              <TouchableOpacity style={styles.input} onPress={() => setShowDevicePicker(true)}>
                <Text style={{ color: '#0F172A', fontSize: 13 }}>
                  {form?.device_id ? (deviceName(form.device_id) || 'Any analyser') : 'Any analyser'}
                </Text>
              </TouchableOpacity>
              <Text style={styles.fieldHint}>Pick one where two machines report this parameter by different techniques.</Text>

              <Text style={styles.fieldLabel}>Text range</Text>
              <TextInput style={styles.input} value={form?.text}
                onChangeText={v => setForm(f => f && ({ ...f, text: v }))}
                placeholder='e.g. "Negative"' placeholderTextColor="#94A3B8" />
              <Text style={styles.fieldHint}>For results that aren't a number. Printed instead of low–high when filled.</Text>

              <View style={styles.editBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setForm(null)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                  <Text style={styles.saveText}>{saving ? 'Saving…' : (form?.id ? 'Save Changes' : 'Add Range')}</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Picker visible={showTestPicker} title="Applies to"
        items={[{ id: 0, name: 'All tests reporting this parameter' }, ...tests]}
        onPick={(id) => { setForm(f => f && ({ ...f, test_id: id || null })); setShowTestPicker(false); }}
        onClose={() => setShowTestPicker(false)} />

      <Picker visible={showDevicePicker} title="Analyser"
        items={[{ id: 0, name: 'Any analyser' }, ...devices]}
        onPick={(id) => { setForm(f => f && ({ ...f, device_id: id || null })); setShowDevicePicker(false); }}
        onClose={() => setShowDevicePicker(false)} />
    </View>
  );
}

function Picker({ visible, title, items, onPick, onClose }:
  { visible: boolean; title: string; items: NamedId[]; onPick: (id: number) => void; onClose: () => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.pickerBox}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }}>
            {items.map(it => (
              <TouchableOpacity key={it.id} style={styles.pickerItem} onPress={() => onPick(it.id)}>
                <Text style={styles.pickerText}>{it.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity style={styles.modalCancel} onPress={onClose}>
            <Text style={styles.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center:       { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center' },
  addBtn:       { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, backgroundColor: '#F97316', alignItems: 'center' },
  addBtnText:   { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  searchWrap:   { padding: 12, paddingBottom: 0 },
  search:       { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  note:         { backgroundColor: '#FEF9C3', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, padding: 12, marginBottom: 12 },
  noteText:     { color: '#92400E', fontSize: 11.5, lineHeight: 17 },
  card:         { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  paramName:    { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
  paramCount:   { color: '#64748B', fontSize: 12, fontWeight: '600' },
  rangeRow:     { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  chipRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 },
  chip:         { backgroundColor: '#F9731622', color: '#C2410C', fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  chipMuted:    { backgroundColor: '#F1F5F9', color: '#64748B', fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  chipTest:     { backgroundColor: '#DBEAFE', color: '#1D4ED8', fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  rangeText:    { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  critical:     { color: '#DC2626', fontSize: 11, marginTop: 2 },
  method:       { color: '#64748B', fontSize: 11, marginTop: 2 },
  actionRow:    { flexDirection: 'row', gap: 6, marginLeft: 8 },
  iconBtn:      { backgroundColor: '#F8FAFC', padding: 8, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  empty:        { alignItems: 'center', marginTop: 60 },
  emptyIcon:    { fontSize: 48 },
  emptyText:    { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:      { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  formBox:      { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32, maxHeight: '92%' },
  modalTitle:   { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  fieldLabel:   { color: '#94A3B8', fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 10 },
  fieldHint:    { color: '#94A3B8', fontSize: 10, marginTop: 4 },
  input:        { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 10, borderRadius: 8, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0' },
  row2:         { flexDirection: 'row', gap: 10 },
  segRow:       { flexDirection: 'row', backgroundColor: '#F1F5F9', borderRadius: 8, padding: 3, gap: 3 },
  seg:          { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  segActive:    { backgroundColor: '#F97316' },
  segText:      { color: '#64748B', fontSize: 12, fontWeight: '600' },
  segTextActive:{ color: '#fff' },
  editBtns:     { flexDirection: 'row', gap: 10, marginTop: 18 },
  cancelBtn:    { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#F8FAFC', alignItems: 'center' },
  cancelText:   { color: '#94A3B8', fontWeight: '600', fontSize: 13 },
  saveBtn:      { flex: 1.5, padding: 12, borderRadius: 8, backgroundColor: '#F97316', alignItems: 'center' },
  saveText:     { color: '#fff', fontWeight: '700', fontSize: 13 },
  pickerBox:    { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pickerItem:   { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  pickerText:   { color: '#0F172A', fontSize: 14 },
  modalCancel:  { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
