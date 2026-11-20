/**
 * Edits everything one patient (barcode) has, laid out like the printed report:
 * one block per test, the analyser transmissions of a test merged, parameters in
 * report order and under report names. Used by the Results detail sheet and by
 * "Edit All", so both behave identically (and like the web Results page).
 *
 * Every row remembers which stored result (and which position in it) it came
 * from, so Save writes each change back to its own result and leaves the rest of
 * that result untouched. Only results that really changed are saved.
 *
 * The Save / Cancel / Calculate bar sits at the TOP (always visible); the rows
 * scroll underneath it.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { API_BASE, authHeader } from '../utils/auth';

const FLAGS = [{ value: 'N', label: 'Normal' }, { value: 'H', label: 'High' }, { value: 'L', label: 'Low' }];
const errText = (d: any) => Array.isArray(d) ? d.map((x: any) => x?.msg ?? String(x)).join('; ') : (d ?? '');
const keyOf = (p: any) => String(p.param || p.name || '').trim().toUpperCase();
const cleanRow = (p: any) => { const { _k, heading, result_id, src_ix, ...rest } = p; return rest; };
const coerce = (v: any) => (isNaN(Number(v)) || String(v).trim() === '' ? v : Number(v));

interface Props {
  ids: number[];
  results: any[];
  noteResultId: number;
  onSaved: (list: { id: number; updated: any }[]) => void;
  onCancel?: () => void;
  maxHeight?: number;
}

export default function MergedEditor({ ids, results, noteResultId, onSaved, onCancel, maxHeight = 430 }: Props) {
  const [panels, setPanels] = useState<any[] | null>(null);   // null = loading
  const [note, setNote]     = useState('');
  const [saving, setSaving] = useState(false);
  const [calcBusy, setCalcBusy]   = useState(false);
  const [calcDirty, setCalcDirty] = useState(false);
  const [addPanel, setAddPanel]   = useState<{ pi: number; list: any[] } | null>(null);
  const [msg, setMsg] = useState('');
  const origRef = useRef<Record<string, any>>({});
  const idsKey = ids.join(',');

  const missingFor = async (id: number, rows: any[]): Promise<any[]> => {
    try {
      const res = await fetch(`${API_BASE}/api/results/${id}/missing-parameters`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: rows }),
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? (data.parameters ?? []) : [];
    } catch { return []; }
  };

  useEffect(() => {
    let live = true; let n = 0;
    setPanels(null); setMsg(''); setCalcDirty(false); setAddPanel(null);
    setNote((results.find(r => r.id === noteResultId) || {}).note ?? '');
    fetch(`${API_BASE}/api/results/report-view?ids=${idsKey}`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : null).then(d => {
        if (!live) return;
        const ps = ((d && d.panels) || []).map((pn: any) => ({
          title: pn.title, accession: pn.accession, primaryId: pn.result_ids[0],
          rows: pn.parameters.map((p: any) => ({ ...p, _k: `k${n++}` })),
        }));
        origRef.current = Object.fromEntries(ps.flatMap((pn: any) => pn.rows.map((r: any) => [r._k, { ...r }])));
        setPanels(ps);
        ps.forEach((pn: any, pi: number) => missingFor(pn.primaryId, pn.rows.map(cleanRow)).then(extra => {
          if (!live) return;
          setPanels(prev => prev && prev.map((x, xi) => xi !== pi ? x : { ...x, rows: [...x.rows,
            ...extra.filter(e => !x.rows.some((p: any) => keyOf(p) === keyOf(e)))
                    .map(e => ({ ...e, result_id: x.primaryId, _k: `m${pi}_${n++}` }))] }));
        }));
      }).catch(() => { if (live) setPanels([]); });
    return () => { live = false; };
  }, [idsKey, noteResultId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (pi: number, ri: number, field: string, val: any) => {
    if (field === 'value') setCalcDirty(true);
    setPanels(prev => prev && prev.map((x, xi) => xi !== pi ? x : { ...x, rows: x.rows.map((r: any, i: number) => i !== ri ? r
      : { ...r, [field]: val, ...(field === 'flag' ? { flag_manual: true } : {}) }) }));
  };
  const remove = (pi: number, ri: number) => {
    setCalcDirty(true); setAddPanel(null);
    setPanels(prev => prev && prev.map((x, xi) => xi !== pi ? x : { ...x, rows: x.rows.filter((_: any, i: number) => i !== ri) }));
  };
  const openAdd = async (pi: number) => {
    const pn = panels![pi];
    setAddPanel({ pi, list: await missingFor(pn.primaryId, pn.rows.map(cleanRow)) });
  };
  const addParam = (row: any) => {
    if (!addPanel) return; const pi = addPanel.pi;
    setPanels(prev => prev && prev.map((x, xi) => xi !== pi ? x : { ...x, rows: [...x.rows, { ...row, result_id: x.primaryId, _k: `a${Date.now()}` }] }));
    setAddPanel(null);
  };

  const calculate = async () => {
    if (!panels) return;
    setCalcBusy(true); setMsg('');
    try {
      for (let pi = 0; pi < panels.length; pi++) {
        const pn = panels[pi];
        const res = await fetch(`${API_BASE}/api/results/${pn.primaryId}/calculate`, {
          method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ parameters: pn.rows.map(cleanRow) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errText(data.detail) || 'Calculate failed');
        const out: any[] = data.parameters || [];
        setPanels(prev => prev && prev.map((x, xi) => {
          if (xi !== pi) return x;
          const rows = [...x.rows];
          out.forEach((op, oi) => {
            const ix = rows.findIndex(r => keyOf(r) === keyOf(op));
            if (ix >= 0) rows[ix] = { ...rows[ix], value: op.value, flag: op.flag ?? rows[ix].flag };
            else rows.push({ ...op, result_id: x.primaryId, _k: `c${Date.now()}_${oi}` });
          });
          return { ...x, rows };
        }));
      }
      setCalcDirty(false);
    } catch (e: any) { setMsg(String(e?.message || 'Calculate failed')); }
    setCalcBusy(false);
  };

  const save = async () => {
    if (!panels) return;
    setSaving(true); setMsg('');
    try {
      const orig = origRef.current;
      const cur = new Map<string, any>(panels.flatMap((pn: any) => pn.rows.map((r: any) => [r._k, r] as [string, any])));
      const byId = new Map<number, any>();
      const get = (id: number) => {
        if (!byId.has(id)) {
          const r = results.find(x => x.id === id);
          byId.set(id, { r, params: ((r?.parsed_data?.parameters) || []).map((p: any) => ({ ...p })), del: new Set<number>(), add: [] as any[], dirty: false });
        }
        return byId.get(id);
      };
      Object.values(orig).forEach((o: any) => {
        if (o.src_ix == null || o.result_id == null) return;
        const c = cur.get(o._k); const e = get(o.result_id); const p = e.params[o.src_ix];
        if (!p) return;
        if (!c) { e.del.add(o.src_ix); e.dirty = true; return; }
        if (String(c.value ?? '') !== String(o.value ?? '')) { p.value = coerce(c.value); e.dirty = true; }
        if ((c.flag || 'N') !== (o.flag || 'N')) { p.flag = c.flag; p.flag_manual = true; e.dirty = true; }
      });
      panels.forEach((pn: any) => pn.rows.forEach((c: any) => {
        const o = orig[c._k];
        if (o && o.src_ix != null) return;
        if (String(c.value ?? '').trim() === '') return;
        if (o && String(c.value) === String(o.value ?? '')) return;
        const e = get(pn.primaryId); e.add.push({ ...cleanRow(c), value: coerce(c.value) }); e.dirty = true;
      }));
      const noteBefore = (results.find(r => r.id === noteResultId) || {}).note ?? '';
      if (note !== noteBefore && noteResultId != null) get(noteResultId).dirty = true;
      const saved: { id: number; updated: any }[] = [];
      for (const [id, e] of byId) {
        if (!e.dirty) continue;
        const params = [...e.params.filter((_: any, i: number) => !e.del.has(i)), ...e.add];
        const res = await fetch(`${API_BASE}/api/results/${id}`, {
          method: 'PUT', headers: { ...authHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ parameters: params, note: id === noteResultId ? note : (e.r?.note || '') }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(errText(data.detail) || 'Save failed');
        saved.push({ id, updated: data });
      }
      setMsg(saved.length ? '✓ Saved' : 'No changes to save');
      if (saved.length) onSaved(saved);
    } catch (e: any) { setMsg(String(e?.message || 'Save failed')); Alert.alert('Save', String(e?.message || 'Save failed')); }
    setSaving(false);
  };

  if (panels === null) return <ActivityIndicator color="#17B9A1" style={{ marginVertical: 18 }} />;
  if (panels.length === 0) return (
    <View><Text style={s.empty}>Nothing to edit here.</Text>
      {onCancel && <TouchableOpacity style={s.cancelBtn} onPress={onCancel}><Text style={s.cancelText}>Close</Text></TouchableOpacity>}</View>
  );

  return (
    <View>
      {/* Save / Cancel / Calculate — always on top, so a long list never needs a scroll to the bottom */}
      <View style={s.bar}>
        {msg ? <Text style={[s.msg, { color: msg.startsWith('✓') ? '#16A34A' : msg.startsWith('No changes') ? '#94A3B8' : '#DC2626' }]} numberOfLines={2}>{msg}</Text> : <View style={{ flex: 1 }} />}
        <TouchableOpacity style={[s.calcBtn, calcDirty && s.calcOn]} onPress={calculate} disabled={calcBusy}>
          {calcBusy ? <ActivityIndicator size="small" color={calcDirty ? '#fff' : '#C2410C'} />
            : <Text style={[s.calcText, calcDirty && { color: '#fff' }]}>🧮 Calculate</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.saveBtn} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.saveText}>✓ Save</Text>}
        </TouchableOpacity>
        {onCancel && <TouchableOpacity style={s.cancelBtn} onPress={onCancel} disabled={saving}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>}
      </View>
      {calcDirty && <Text style={s.hint}>Values changed — tap Calculate to refresh VLDL / ratios</Text>}

      <ScrollView style={{ maxHeight }} nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {panels.map((pn, pi) => (
          <View key={pn.accession || pi} style={{ marginBottom: 14 }}>
            <Text style={s.panelTitle}>{pn.title}</Text>
            {pn.rows.map((p: any, ri: number) => (
              <View key={p._k} style={s.row}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[s.name, { flex: 1 }]}>{p.name || p.param}
                    {p.calculated ? <Text style={s.tag}>  · calculated</Text> : null}
                    {p.added ? <Text style={s.tag}>  · enter manually</Text> : null}</Text>
                  <TouchableOpacity onPress={() => remove(pi, ri)} hitSlop={8}><Text style={s.x}>✕</Text></TouchableOpacity>
                </View>
                <TextInput style={s.input} value={String(p.value ?? '')} onChangeText={v => setField(pi, ri, 'value', v)} keyboardType="numeric" />
                <View style={s.flagRow}>
                  {FLAGS.map(f => (
                    <TouchableOpacity key={f.value} style={[s.flagOpt, (p.flag || 'N') === f.value && s.flagOn]} onPress={() => setField(pi, ri, 'flag', f.value)}>
                      <Text style={[s.flagText, (p.flag || 'N') === f.value && s.flagTextOn]}>{f.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={s.ref}>{p.unit ?? ''}{p.ref_text ? ` · ${String(p.ref_text).split('\n')[0]}…` : ` · ${p.ref_min ?? ''}–${p.ref_max ?? ''}`}</Text>
              </View>
            ))}
            <TouchableOpacity style={s.addBtn} onPress={() => openAdd(pi)}><Text style={s.addText}>+ Add parameter</Text></TouchableOpacity>
            {addPanel && addPanel.pi === pi && (addPanel.list.length === 0
              ? <Text style={s.hint}>Every parameter of this test is already listed.</Text>
              : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {addPanel.list.map((r, k) => (
                    <TouchableOpacity key={k} style={s.chip} onPress={() => addParam(r)}><Text style={s.chipText}>{r.name}</Text></TouchableOpacity>
                  ))}
                </View>)}
          </View>
        ))}
        <Text style={s.noteLabel}>NOTE (shown at the end of the report if filled in)</Text>
        <TextInput style={s.noteInput} value={note} onChangeText={setNote} multiline numberOfLines={3}
          placeholder="e.g. Sample slightly hemolysed; recommend repeat in 2 weeks" placeholderTextColor="#94A3B8" />
        <View style={{ height: 10 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  empty:      { color: '#94A3B8', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  bar:        { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', marginBottom: 6 },
  msg:        { flex: 1, fontSize: 11.5, fontWeight: '700' },
  calcBtn:    { borderWidth: 1, borderColor: '#F9731666', backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7 },
  calcOn:     { backgroundColor: '#F97316', borderColor: '#F97316' },
  calcText:   { color: '#C2410C', fontWeight: '700', fontSize: 12 },
  saveBtn:    { backgroundColor: '#10B981', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  saveText:   { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  cancelBtn:  { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  cancelText: { color: '#64748B', fontWeight: '600', fontSize: 12 },
  hint:       { color: '#C2410C', fontSize: 11, fontWeight: '700', marginBottom: 6 },
  panelTitle: { color: '#0F172A', fontSize: 12.5, fontWeight: '800', textTransform: 'uppercase', borderBottomWidth: 2, borderBottomColor: '#0F172A', paddingBottom: 3, marginBottom: 4, marginTop: 6 },
  row:        { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  name:       { color: '#0F172A', fontSize: 13, fontWeight: '700', marginBottom: 5 },
  tag:        { color: '#C2410C', fontSize: 10, fontWeight: '700' },
  x:          { color: '#DC2626', fontSize: 16, fontWeight: '700' },
  input:      { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 13, fontWeight: '700', borderWidth: 1.5, borderColor: '#17B9A1', marginBottom: 6 },
  flagRow:    { flexDirection: 'row', gap: 6, marginBottom: 5 },
  flagOpt:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  flagOn:     { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  flagText:   { color: '#64748B', fontSize: 11, fontWeight: '600' },
  flagTextOn: { color: '#EF4444' },
  ref:        { color: '#94A3B8', fontSize: 11 },
  addBtn:     { alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: '#3B82F680', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#fff', marginTop: 8 },
  addText:    { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  chip:       { borderWidth: 1, borderColor: '#BFDBFE', backgroundColor: '#EFF6FF', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  chipText:   { color: '#1D4ED8', fontSize: 12, fontWeight: '600' },
  noteLabel:  { color: '#475569', fontSize: 11, fontWeight: '700', marginTop: 6, marginBottom: 6 },
  noteInput:  { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 70, textAlignVertical: 'top' },
});
