/**
 * One control that picks either an individual test or a test group, for the
 * filter bars on Results, Bills and Sample / Test Details.
 *
 * The chosen value is a single string — "t:317" for a test, "p:12" for a group
 * — so a screen keeps one piece of state; `splitTestFilter` turns it back into
 * the query parameters the API takes. Groups come first and are labelled,
 * because a lab that bills "THYROID PROFILE" thinks of it as one thing while
 * its member tests also exist on their own.
 */
import React, { useEffect, useState } from 'react';
import {
  Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { API_BASE, authHeader } from '../utils/auth';

export type TestOption = { value: string; label: string };

export function splitTestFilter(v: string | null | undefined): Record<string, string> {
  const s = String(v || '');
  if (s.startsWith('p:')) return { package_id: s.slice(2) };
  if (s.startsWith('t:')) return { test_id: s.slice(2) };
  return {};
}

export function useTestOptions() {
  const [opts, setOpts] = useState<TestOption[]>([]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch(`${API_BASE}/api/catalog/tests`, { headers: authHeader() }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch(`${API_BASE}/api/catalog/packages`, { headers: authHeader() }).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([tests, packs]: any[]) => {
      if (!alive) return;
      const g: TestOption[] = (Array.isArray(packs) ? packs : [])
        .map((p: any) => ({ value: `p:${p.id}`, label: `[Group] ${p.name}` }))
        .sort((a, b) => a.label.localeCompare(b.label));
      const t: TestOption[] = (Array.isArray(tests) ? tests : [])
        .filter((x: any) => x.is_active !== false)
        .map((x: any) => ({ value: `t:${x.id}`, label: x.name }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setOpts([...g, ...t]);
    });
    return () => { alive = false; };
  }, []);
  return opts;
}

export default function TestFilter(
  { value, onChange, options, label = 'Test / Group' }:
  { value: string; onChange: (v: string) => void; options: TestOption[]; label?: string },
) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  useEffect(() => { if (open) setQ(''); }, [open]);

  const chosen = options.find(o => o.value === value);
  const needle = q.trim().toLowerCase();
  const list = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <View>
      <TouchableOpacity style={s.field} onPress={() => setOpen(true)}>
        <Text style={[s.fieldText, !chosen && s.fieldPlaceholder]} numberOfLines={1}>
          {chosen ? chosen.label : `${label}: All`}
        </Text>
        {!!chosen && (
          <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.clear}>✕</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <View style={s.box}>
            <Text style={s.title}>{label}</Text>
            <TextInput style={s.search} value={q} onChangeText={setQ}
              autoCorrect={false} autoCapitalize="none"
              placeholder="🔍  Search tests and groups…" placeholderTextColor="#94A3B8" />
            <ScrollView style={{ maxHeight: 340 }} keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={s.item} onPress={() => { onChange(''); setOpen(false); }}>
                <Text style={[s.itemText, { color: '#64748B' }]}>All tests</Text>
              </TouchableOpacity>
              {list.map(o => (
                <TouchableOpacity key={o.value} style={s.item}
                  onPress={() => { onChange(o.value); setOpen(false); }}>
                  <Text style={s.itemText} numberOfLines={2}>{o.label}</Text>
                </TouchableOpacity>
              ))}
              {list.length === 0 && <Text style={s.empty}>Nothing matches that.</Text>}
            </ScrollView>
            <TouchableOpacity style={s.cancel} onPress={() => setOpen(false)}>
              <Text style={s.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  field:       { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF',
                 borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
  fieldText:   { flex: 1, color: '#0F172A', fontSize: 13.5, fontWeight: '600' },
  fieldPlaceholder: { color: '#94A3B8', fontWeight: '400' },
  clear:       { color: '#94A3B8', fontSize: 14, fontWeight: 'bold', paddingHorizontal: 2 },
  overlay:     { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  box:         { backgroundColor: '#FFFFFF', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, paddingBottom: 26 },
  title:       { color: '#0F172A', fontSize: 15, fontWeight: 'bold', marginBottom: 10 },
  search:      { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 11, borderRadius: 10,
                 fontSize: 13.5, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 8 },
  item:        { paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  itemText:    { color: '#0F172A', fontSize: 13.5 },
  empty:       { color: '#94A3B8', fontSize: 13, padding: 16, textAlign: 'center' },
  cancel:      { marginTop: 12, padding: 13, borderRadius: 10, backgroundColor: '#F1F5F9', alignItems: 'center' },
  cancelText:  { color: '#475569', fontWeight: 'bold', fontSize: 13.5 },
});
