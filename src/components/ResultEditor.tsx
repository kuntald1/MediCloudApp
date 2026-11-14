/**
 * The parameter-value editor, on its own so a screen can show several at once:
 * the Results screen's "Edit All" popup puts one of these under every barcode
 * it loaded, and Blank Report uses one to fill in a report no analyser sent.
 * Each instance talks to its own result and keeps its own Save button, so
 * saving one report never touches another.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { API_BASE, authHeader } from '../utils/auth';

export interface EditorParam {
  name: string; value: number | string; unit?: string;
  ref_min?: number | string; ref_max?: number | string;
  flag?: string; param?: string; calculated?: boolean; flag_manual?: boolean; added?: boolean;
}
export interface EditorResult {
  id: number; parsed_data?: { parameters?: EditorParam[] } | null; note?: string | null;
}

const FLAGS = [{ value: 'N', label: 'Normal' }, { value: 'H', label: 'High' }, { value: 'L', label: 'Low' }];

const toPayload = (p: any) => ({
  param: p.param, name: p.name,
  value: isNaN(Number(p.value)) || String(p.value).trim() === '' ? p.value : Number(p.value),
  unit: p.unit, ref_min: p.ref_min, ref_max: p.ref_max, flag: p.flag || undefined,
  flag_manual: p.flag_manual || undefined, calculated: p.calculated || undefined,
  added: p.added || undefined,
});
const errText = (d: any) => Array.isArray(d) ? d.map((x: any) => x?.msg ?? String(x)).join('; ') : (d ?? '');

export default function ResultEditor(
  { result, onSaved }: { result: EditorResult; onSaved?: (updated: any) => void },
) {
  const [params, setParams]   = useState<EditorParam[]>([]);
  const [note, setNote]       = useState('');
  const [saving, setSaving]   = useState(false);
  const [calcBusy, setCalcBusy]   = useState(false);
  const [calcDirty, setCalcDirty] = useState(false);
  const [addList, setAddList] = useState<EditorParam[] | null>(null);
  const [savedAt, setSavedAt] = useState(false);

  const loadMissing = async (rows: EditorParam[]) => {
    try {
      const res = await fetch(`${API_BASE}/api/results/${result.id}/missing-parameters`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: rows.map(toPayload) }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.parameters ?? []) : [];
    } catch { return []; }
  };

  useEffect(() => {
    const base = (result.parsed_data?.parameters ?? []).map(p => ({ ...p }));
    setParams(base); setNote(result.note ?? ''); setCalcDirty(false); setAddList(null); setSavedAt(false);
    loadMissing(base).then((extra: EditorParam[]) =>
      setParams(prev => [...prev, ...extra.filter(e => !prev.some(p => p.name === e.name))]));
  }, [result.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setValue = (i: number, v: string) => {
    setCalcDirty(true); setSavedAt(false);
    setParams(prev => prev.map((p, idx) => idx === i ? { ...p, value: v } : p));
  };
  const setFlag = (i: number, flag: string) => {
    setSavedAt(false);
    setParams(prev => prev.map((p, idx) => idx === i ? { ...p, flag, flag_manual: true } : p));
  };
  const remove = (i: number) => { setParams(prev => prev.filter((_, idx) => idx !== i)); setCalcDirty(true); setAddList(null); };
  const openAdd = async () => setAddList(await loadMissing(params));
  const addParam = (row: EditorParam) => { setParams(prev => [...prev, row]); setAddList(null); };

  const calculate = async () => {
    setCalcBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/results/${result.id}/calculate`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: params.map(toPayload) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(data.detail) || 'Calculate failed');
      setParams(data.parameters); setCalcDirty(false);
    } catch (e: any) { Alert.alert('Calculate', e.message); }
    finally { setCalcBusy(false); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/results/${result.id}`, {
        method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: params.map(toPayload), note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(errText(data.detail) || 'Could not save changes');
      setSavedAt(true);
      onSaved && onSaved(data);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setSaving(false); }
  };

  return (
    <View>
      <View style={s.calcRow}>
        {calcDirty && <Text style={s.calcHint}>Values changed — tap Calculate to refresh calculated rows</Text>}
        <TouchableOpacity style={[s.calcBtn, calcDirty && s.calcBtnOn]} onPress={calculate} disabled={calcBusy}>
          {calcBusy ? <ActivityIndicator size="small" color={calcDirty ? '#fff' : '#C2410C'} />
            : <Text style={[s.calcBtnText, calcDirty && { color: '#fff' }]}>🧮 Calculate</Text>}
        </TouchableOpacity>
      </View>

      {params.length === 0 && <Text style={s.calcHint}>This report has no parameters yet.</Text>}

      {params.map((p, i) => (
        <View key={i} style={s.row}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={[s.name, { flex: 1 }]}>
              {p.name}
              {p.calculated ? <Text style={s.tag}>  · calculated</Text> : null}
              {p.added ? <Text style={s.tag}>  · enter manually</Text> : null}
            </Text>
            <TouchableOpacity onPress={() => remove(i)} hitSlop={8}>
              <Text style={{ color: '#DC2626', fontSize: 16, fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <TextInput style={s.input} value={String(p.value ?? '')}
            onChangeText={v => setValue(i, v)} keyboardType="numeric" />
          <View style={s.flagPicker}>
            {FLAGS.map(opt => (
              <TouchableOpacity key={opt.value} style={[s.flagOpt, (p.flag ?? 'N') === opt.value && s.flagOptSel]}
                onPress={() => setFlag(i, opt.value)}>
                <Text style={[s.flagOptText, (p.flag ?? 'N') === opt.value && s.flagOptTextSel]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.ref}>{p.unit ?? ''} · {p.ref_min}–{p.ref_max}</Text>
        </View>
      ))}

      <View style={{ marginTop: 8 }}>
        <TouchableOpacity style={s.addBtn} onPress={openAdd}>
          <Text style={s.addBtnText}>+ Add parameter</Text>
        </TouchableOpacity>
        {addList && (addList.length === 0
          ? <Text style={s.calcHint}>Every parameter of this test is already listed.</Text>
          : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {addList.map((r, k) => (
                <TouchableOpacity key={k} style={s.chip} onPress={() => addParam(r)}>
                  <Text style={s.chipText}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </View>)}
      </View>

      <Text style={s.noteLabel}>NOTE (shown at the end of the report if filled in)</Text>
      <TextInput style={s.noteInput} value={note} onChangeText={setNote}
        placeholder="e.g. Sample slightly hemolysed; recommend repeat in 2 weeks"
        placeholderTextColor="#94A3B8" multiline numberOfLines={3} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <TouchableOpacity style={[s.saveBtn, { flex: 1 }]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveBtnText}>✓ Save</Text>}
        </TouchableOpacity>
        {savedAt && <Text style={s.saved}>✓ Saved</Text>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  calcRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  calcHint:    { color: '#C2410C', fontSize: 11, fontWeight: '700', flex: 1 },
  calcBtn:     { borderWidth: 1, borderColor: 'rgba(249,115,22,0.4)', backgroundColor: '#fff',
                 borderRadius: 8, paddingVertical: 7, paddingHorizontal: 12 },
  calcBtnOn:   { backgroundColor: '#F97316', borderColor: '#F97316' },
  calcBtnText: { color: '#C2410C', fontWeight: 'bold', fontSize: 12 },
  row:         { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 10, marginBottom: 8 },
  name:        { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  tag:         { color: '#C2410C', fontSize: 10.5, fontWeight: '700' },
  input:       { marginTop: 6, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#F97316',
                 borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: '#0F172A', fontSize: 14, fontWeight: '700' },
  flagPicker:  { flexDirection: 'row', gap: 6, marginTop: 6 },
  flagOpt:     { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 10, backgroundColor: '#fff' },
  flagOptSel:  { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  flagOptText: { color: '#64748B', fontSize: 11.5, fontWeight: '600' },
  flagOptTextSel: { color: '#fff' },
  ref:         { color: '#94A3B8', fontSize: 11, marginTop: 6 },
  addBtn:      { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(59,130,246,0.5)', borderRadius: 8,
                 paddingVertical: 9, alignItems: 'center', backgroundColor: '#fff' },
  addBtnText:  { color: '#1D4ED8', fontWeight: 'bold', fontSize: 12 },
  chip:        { backgroundColor: 'rgba(59,130,246,0.08)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.25)',
                 borderRadius: 100, paddingVertical: 5, paddingHorizontal: 11 },
  chipText:    { color: '#1D4ED8', fontSize: 11.5, fontWeight: '600' },
  noteLabel:   { color: '#64748B', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, marginBottom: 5 },
  noteInput:   { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 10,
                 padding: 10, color: '#0F172A', fontSize: 13, minHeight: 64, textAlignVertical: 'top' },
  saveBtn:     { backgroundColor: '#16A34A', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13.5 },
  saved:       { color: '#16A34A', fontSize: 12, fontWeight: '700' },
});
