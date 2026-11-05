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
/** The catalog rows arrive whole from /catalog/tests, so `parameters` and
 *  `price` are there at runtime even though the parent types them loosely. */
interface NamedId { id: number; name: string; parameters?: string | null; price?: number | null; }

// Matches the web: 'C' is a label for an age-banded row, not a sex of its own.
const GROUP_LABEL: Record<string, string> = { A: 'Any', M: 'Male', F: 'Female', C: 'Children' };
const GROUPS: [string, string][] = [['A','Any'], ['M','Male'], ['F','Female'], ['C','Children']];

// `scope` is test_id put into words. It exists because "common or just this
// test" is a decision, and buried as one more entry in a list of test names it
// did not read like one. `_was` remembers what the row was opened as, so
// narrowing a common row can offer to copy instead of silently moving it.
const BLANK = {
  id: null as number | null,
  param: '', test_id: null as number | null, scope: 'common' as 'common' | 'test',
  _was: null as number | null | undefined, sex: 'A',
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
  const [ask, setAsk]         = useState<typeof BLANK | null>(null);
  const [askMode, setAskMode] = useState<'copy' | 'move'>('copy');

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

  // Grouped the way the lab reads it, exactly like the web page: the shared
  // ranges first, then one block per test. Grouping by parameter instead
  // scattered a single test's settings down the screen.
  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter(r => (r.param || '').toLowerCase().includes(q)
                    || (testName(r.test_id) || '').toLowerCase().includes(q))
    : rows;
  const byParam = (a: Range, b: Range) =>
    (a.param || '').toUpperCase().localeCompare((b.param || '').toUpperCase()) || (a.id - b.id);
  const groups: { key: string; common: boolean; title: string; rows: Range[] }[] = [];
  const commonRows = shown.filter(r => r.test_id == null).sort(byParam);
  if (commonRows.length) groups.push({ key: '__common', common: true, title: 'Shared ranges', rows: commonRows });
  const perTest = new Map<number, Range[]>();
  shown.filter(r => r.test_id != null).forEach(r => {
    const k = r.test_id as number;
    if (!perTest.has(k)) perTest.set(k, []);
    (perTest.get(k) as Range[]).push(r);
  });
  Array.from(perTest.entries())
    .map(([id, rs]) => ({ key: 't' + id, common: false,
                          title: testName(id) || `Test #${id}`, rows: rs.sort(byParam) }))
    .sort((a, b) => a.title.localeCompare(b.title))
    .forEach(g => groups.push(g));

  // Which tests name this parameter in "Parameters printed on the report".
  // That field is optional and blank means "print whatever the analyser sent",
  // so a test can report the parameter without turning up here — which is why
  // the warning built from it always ends with "and any other test".
  const testsDeclaring = (param: string) => {
    const pn = (param || '').trim().toUpperCase();
    if (!pn) return [] as NamedId[];
    return tests.filter(t => String(t.parameters || '').split(',')
                               .map(x => x.trim().toUpperCase()).filter(Boolean).includes(pn));
  };

  const openNew  = () => setForm({ ...BLANK });
  const openEdit = (r: Range) => setForm({
    id: r.id, param: r.param || '', test_id: r.test_id,
    scope: r.test_id != null ? 'test' : 'common', _was: r.test_id ?? null,
    sex: (r.sex || 'A').toUpperCase(),
    age_min: r.age_min?.toString() ?? '', age_max: r.age_max?.toString() ?? '',
    age_min_months: r.age_min_months?.toString() ?? '', age_max_months: r.age_max_months?.toString() ?? '',
    low: r.low?.toString() ?? '', high: r.high?.toString() ?? '',
    critical_low: r.critical_low?.toString() ?? '', critical_high: r.critical_high?.toString() ?? '',
    unit: r.unit || '', text: r.text || '', method: r.method || '', device_id: r.device_id,
  });

  const payloadOf = (f: typeof BLANK) => ({
    param: f.param.trim(), test_id: f.scope === 'test' ? f.test_id : null, sex: f.sex,
    age_min: num(f.age_min), age_max: num(f.age_max),
    age_min_months: num(f.age_min_months), age_max_months: num(f.age_max_months),
    low: num(f.low), high: num(f.high),
    critical_low: num(f.critical_low), critical_high: num(f.critical_high),
    unit: f.unit.trim() || null, text: f.text.trim() || null,
    method: f.method.trim() || null, device_id: f.device_id,
  });

  /** id null = create a new row; otherwise update that one. */
  const persist = async (id: number | null, payload: object) => {
    setSaving(true);
    try {
      const res = await fetch(
        id ? `${API_BASE}/api/catalog/reference-ranges/${id}` : `${API_BASE}/api/catalog/reference-ranges`,
        { method: id ? 'PUT' : 'POST',
          headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(await res.text());
      setAsk(null); setForm(null); load();
    } catch {
      Alert.alert('Could not save', 'The range was not saved. Check the values and try again.');
    }
    setSaving(false);
  };

  const save = async () => {
    if (!form) return;
    if (!form.param.trim()) { Alert.alert('Parameter required', 'Type it exactly as the analyser reports it.'); return; }
    if (form.scope === 'test' && form.test_id == null) {
      Alert.alert('Pick a test', 'This range is set to one test only, so choose which one.'); return;
    }
    if (form.low === '' && form.high === '' && !form.text.trim() && !form.method.trim()) {
      Alert.alert('Nothing to save', 'Give a low, a high, a text range, or a method.'); return;
    }
    // Narrowing a common row to one test would quietly strip the default from
    // every other test, so ask which was meant rather than guessing.
    if (form.id && form._was == null && form.scope === 'test') { setAskMode('copy'); setAsk(form); return; }
    await persist(form.id, payloadOf(form));
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
            <View style={styles.groupHead}>
              <Text style={[styles.pill, g.common ? styles.pillCommon : styles.pillTest]}>
                {g.common ? 'COMMON · ALL TESTS' : 'THIS TEST ONLY'}
              </Text>
            </View>
            <Text style={styles.paramName}>
              {g.title} <Text style={styles.paramCount}>· {g.rows.length} range{g.rows.length > 1 ? 's' : ''}</Text>
            </Text>
            {g.common && (
              <Text style={styles.groupNote}>
                These apply wherever the parameter is reported. Changing one here changes it for every test.
              </Text>
            )}
            {g.rows.map(r => (
              <View key={r.id} style={styles.rangeRow}>
                <View style={{ flex: 1 }}>
                  <View style={styles.chipRow}>
                    <Text style={styles.chipParam}>{r.param || '—'}</Text>
                    <Text style={styles.chip}>{GROUP_LABEL[(r.sex || 'A').toUpperCase()] || r.sex}</Text>
                    <Text style={styles.chipMuted}>{ageText(r)}</Text>
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

              {/* Applies to — the one decision that used to hide as the first
                  entry in a list of test names. The test picker only opens
                  once "This test only" is chosen, so the common case never
                  meets the long list at all. */}
              <Text style={styles.fieldLabel}>Applies to *</Text>
              <View style={styles.scopeRow}>
                <TouchableOpacity activeOpacity={0.85}
                  style={[styles.scopeOpt, form?.scope === 'common' && styles.scopeOptOn]}
                  onPress={() => setForm(f => f && ({ ...f, scope: 'common', test_id: null }))}>
                  <View style={[styles.radio, form?.scope === 'common' && styles.radioOn]}>
                    {form?.scope === 'common' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scopeTitle}>Common</Text>
                    <Text style={styles.scopeSub}>Every test that reports {form?.param.trim() || 'this parameter'}</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.85}
                  style={[styles.scopeOpt, form?.scope === 'test' && styles.scopeOptOn]}
                  onPress={() => setForm(f => f && ({ ...f, scope: 'test' }))}>
                  <View style={[styles.radio, form?.scope === 'test' && styles.radioOn]}>
                    {form?.scope === 'test' && <View style={styles.radioDot} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scopeTitle}>This test only</Text>
                    <Text style={styles.scopeSub}>Pick one test</Text>
                  </View>
                </TouchableOpacity>
              </View>

              {form?.scope === 'common' ? (
                <Text style={styles.fieldHint}>
                  Most ranges are common — written once, used by every test reporting the parameter.
                </Text>
              ) : (
                <TouchableOpacity style={[styles.input, form?.test_id == null && styles.inputEmpty]}
                                  onPress={() => setShowTestPicker(true)}>
                  <Text style={{ color: form?.test_id == null ? '#94A3B8' : '#0F172A', fontSize: 13 }}>
                    {form?.test_id != null ? (testName(form.test_id) || `Test #${form.test_id}`) : 'Choose a test…'}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Editing a shared row reaches further than the person may realise. */}
              {!!form?.id && form?.scope === 'common' && (
                <View style={styles.warnBox}>
                  <Text style={styles.warnText}>
                    ⚠  This is a common range. Saving changes it everywhere {form.param.trim() || 'this parameter'} is
                    reported{testsDeclaring(form.param).length
                      ? ` — ${testsDeclaring(form.param).slice(0, 3).map(t => t.name).join(', ')}` +
                        (testsDeclaring(form.param).length > 3 ? ` and ${testsDeclaring(form.param).length - 3} more` : '')
                      : ''}, and any other test reporting it.
                  </Text>
                </View>
              )}

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

      <Picker visible={showTestPicker} title="Which test?" searchable items={tests}
        onPick={(id) => { setForm(f => f && ({ ...f, test_id: id })); setShowTestPicker(false); }}
        onClose={() => setShowTestPicker(false)} />

      {/* A common row being narrowed to one test: copying keeps every other
          test covered, moving does not. Asking costs one tap and saves a
          silent regression on reports nobody was looking at. */}
      <Modal visible={!!ask} transparent animationType="fade" onRequestClose={() => setAsk(null)}>
        <View style={styles.overlay}>
          <View style={styles.askBox}>
            <Text style={styles.modalTitle}>Make this specific to one test?</Text>
            <Text style={styles.askLead}>
              {ask?.param} · {GROUP_LABEL[(ask?.sex || 'A').toUpperCase()]} is currently a common range.
            </Text>
            {([['copy', `Add an override for ${testName(ask?.test_id ?? null) || 'this test'}`,
                        'The common range stays for every other test. Recommended.'],
               ['move', 'Move it — remove the common range',
                        'Other tests fall back to whatever the analyser sent.']] as const).map(([m, t, sub]) => (
              <TouchableOpacity key={m} activeOpacity={0.85}
                style={[styles.choice, askMode === m && styles.choiceOn]}
                onPress={() => setAskMode(m as 'copy' | 'move')}>
                <Text style={styles.choiceTitle}>{t}</Text>
                <Text style={styles.choiceSub}>{sub}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.editBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAsk(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} disabled={saving}
                onPress={() => ask && persist(askMode === 'copy' ? null : ask.id, payloadOf(ask))}>
                <Text style={styles.saveText}>{saving ? 'Saving…' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Picker visible={showDevicePicker} title="Analyser"
        items={[{ id: 0, name: 'Any analyser' }, ...devices]}
        onPick={(id) => { setForm(f => f && ({ ...f, device_id: id || null })); setShowDevicePicker(false); }}
        onClose={() => setShowDevicePicker(false)} />
    </View>
  );
}

function Picker({ visible, title, items, onPick, onClose, searchable }:
  { visible: boolean; title: string; items: NamedId[]; onPick: (id: number) => void;
    onClose: () => void; searchable?: boolean }) {
  const [q, setQ] = useState('');
  // Start each opening from a clean search — a leftover filter looks like a
  // catalog that has lost half its tests.
  useEffect(() => { if (visible) setQ(''); }, [visible]);
  const needle = q.trim().toLowerCase();
  const list = needle ? items.filter(it => (it.name || '').toLowerCase().includes(needle)) : items;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.pickerBox}>
          <Text style={styles.modalTitle}>{title}</Text>
          {searchable && (
            <TextInput style={styles.pickerSearch} value={q} onChangeText={setQ}
              autoCorrect={false} autoCapitalize="none"
              placeholder="🔍  Search tests…" placeholderTextColor="#94A3B8" />
          )}
          <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
            {list.map(it => (
              <TouchableOpacity key={it.id} style={styles.pickerItem} onPress={() => onPick(it.id)}>
                <Text style={[styles.pickerText, { flex: 1 }]} numberOfLines={2}>{it.name}</Text>
                {/* the price tells two same-named tests apart */}
                {it.price != null && <Text style={styles.pickerMeta}>₹{it.price}</Text>}
              </TouchableOpacity>
            ))}
            {list.length === 0 && <Text style={styles.pickerEmpty}>No test matches that.</Text>}
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
  groupHead:    { flexDirection: 'row', marginBottom: 6 },
  pill:         { fontSize: 9.5, fontWeight: 'bold', letterSpacing: 0.7, paddingVertical: 3,
                  paddingHorizontal: 9, borderRadius: 100, overflow: 'hidden', borderWidth: 1 },
  pillCommon:   { backgroundColor: 'rgba(23,163,116,0.1)', borderColor: 'rgba(23,163,116,0.28)', color: '#15855F' },
  pillTest:     { backgroundColor: 'rgba(249,115,22,0.08)', borderColor: 'rgba(249,115,22,0.2)', color: '#F97316' },
  groupNote:    { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 8,
                  padding: 8, color: '#92400E', fontSize: 11.5, lineHeight: 17, marginBottom: 8 },
  chipParam:    { color: '#0F172A', fontSize: 12, fontWeight: 'bold' },

  scopeRow:     { gap: 8 },
  scopeOpt:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1.5,
                  borderColor: '#E8ECF4', borderRadius: 11, padding: 11, backgroundColor: '#fff' },
  scopeOptOn:   { borderColor: '#F97316', backgroundColor: 'rgba(249,115,22,0.05)' },
  radio:        { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, borderColor: '#C9D2DF',
                  backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn:      { borderColor: '#F97316' },
  radioDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#F97316' },
  scopeTitle:   { color: '#0F172A', fontSize: 13.5, fontWeight: 'bold' },
  scopeSub:     { color: '#64748B', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  inputEmpty:   { borderColor: '#FBBF24' },
  warnBox:      { backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 8,
                  padding: 9, marginTop: 10 },
  warnText:     { color: '#92400E', fontSize: 11.5, lineHeight: 17 },

  askBox:       { backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '90%', maxWidth: 420 },
  askLead:      { color: '#64748B', fontSize: 12.5, lineHeight: 18, marginBottom: 14 },
  choice:       { borderWidth: 1.5, borderColor: '#E8ECF4', borderRadius: 11, padding: 11, marginBottom: 8 },
  choiceOn:     { borderColor: '#F97316', backgroundColor: 'rgba(249,115,22,0.05)' },
  choiceTitle:  { color: '#0F172A', fontSize: 13.5, fontWeight: 'bold' },
  choiceSub:    { color: '#64748B', fontSize: 11.5, marginTop: 2, lineHeight: 16 },

  pickerSearch: { backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10,
                  paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#0F172A', marginBottom: 8 },
  pickerMeta:   { color: '#94A3B8', fontSize: 11.5, fontWeight: '600', marginLeft: 10 },
  pickerEmpty:  { color: '#94A3B8', fontSize: 12.5, padding: 14, textAlign: 'center' },

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
  pickerItem:   { padding: 14, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0',
                  flexDirection: 'row', alignItems: 'center' },
  pickerText:   { color: '#0F172A', fontSize: 14 },
  modalCancel:  { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalCancelText: { color: '#EF4444', fontWeight: '700' },
});
