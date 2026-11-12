import { authHeader, API_BASE, getToken } from '../../../src/utils/auth';
import { uploadPickedFile } from '../../../src/utils/uploadPickedFile';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Modal, ScrollView, Platform,
} from 'react-native';

const STAGES = ['', 'dispatched', 'received', 'tested', 'validated', 'reported'];
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const orgLabel = (o: any) => (o.code && !String(o.name || '').toUpperCase().startsWith(String(o.code).trim().toUpperCase())) ? `${o.code} - ${o.name}` : o.name;

interface Param  { name: string; value: number | string; unit?: string; ref_min?: number; ref_max?: number; flag?: string; param?: string; calculated?: boolean; flag_manual?: boolean; }
interface Result {
  id: number; barcode: string; patient_name: string;
  test_name?: string; status: string; lifecycle_status?: string;
  created_at: string; device_name?: string; accession_number?: string;
  parsed_data?: { parameters?: Param[]; protocol?: string } | null;
  note?: string | null;
  // Outsourced-origin marker — field name not fully confirmed against the live
  // API response yet, so isOutsourced() below checks several plausible names.
  is_outsourced?: boolean;
  source?: string;
}
interface Attachment {
  result_id: number; test_name?: string; id: number; filename: string;
  content_type?: string; url: string; uploaded_at?: string;
}

// NOTE: confirm the exact field the live /api/results/ response uses to mark
// an outsourced-origin result — checking several plausible names defensively
// until that's verified, same caution as other endpoints in this app.
const isOutsourced = (r: Result) =>
  !!r.is_outsourced || r.source === 'outsourced' || r.status === 'outsource' || r.lifecycle_status === 'outsource';

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B', collected: '#3B82F6', tested: '#F97316',
  validated: '#A855F7', reported: '#10B981', completed: '#10B981',
  sample_rejected: '#EF4444', rejected: '#EF4444',
};

const FLAG_OPTIONS = [
  { label: 'Normal', value: '' },
  { label: 'High',   value: 'H' },
  { label: 'Low',    value: 'L' },
];

const fmtDateTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-IN', {
  day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
}) : '';

// What the server needs for one edited row. `param` (the analyser code) and
// `calculated` (VLDL / lipid ratios) must travel too, or a saved calculated row
// can't be refreshed by Calculate later.
const toPayload = (p: any) => ({
  param: p.param, name: p.name,
  value: isNaN(Number(p.value)) || String(p.value).trim() === '' ? p.value : Number(p.value),
  unit: p.unit, ref_min: p.ref_min, ref_max: p.ref_max, flag: p.flag || undefined,
  flag_manual: p.flag_manual || undefined, calculated: p.calculated || undefined,
});

export default function Results() {
  const [results, setResults]       = useState<Result[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch]         = useState('');
  const [patientName, setPatientName] = useState('');
  // more filters (same set as the web Results page) + the report ZIP
  const [showFilters, setShowFilters] = useState(false);
  const [orgs, setOrgs]             = useState<any[]>([]);
  const [orgId, setOrgId]           = useState<number | null>(null);
  const [orgQuery, setOrgQuery]     = useState('');
  const [patientId, setPatientId]   = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [stage, setStage]           = useState('');
  const [picker, setPicker]         = useState<'org' | 'stage' | 'from' | 'to' | null>(null);
  const [zipBusy, setZipBusy]       = useState(false);
  const [pdfLoading, setPdfLoading] = useState<number | null>(null);
  const [combineLoading, setCombineLoading] = useState(false);

  // Detail modal
  const [sel, setSel] = useState<Result | null>(null);

  // Outsourced-result attachments. `attachments` = full management list
  // (lab-staff only, powers upload/delete). `attachmentsForDl` = the
  // any-role read-only list — this is what the Download button relies on,
  // per the confirmed contract, so its "empty → disable" check is accurate
  // regardless of role.
  const [attachments, setAttachments]         = useState<Attachment[]>([]);
  const [attachmentsForDl, setAttachmentsForDl] = useState<Attachment[]>([]);
  const [attLoading, setAttLoading]           = useState(false);
  const [attUploading, setAttUploading]       = useState(false);

  // Edit mode (lab admin only — franchise portal has no Edit at all)
  const [editing, setEditing]     = useState(false);
  const [editParams, setEditParams] = useState<Param[]>([]);
  const [editNote, setEditNote]     = useState('');
  const [saving, setSaving]         = useState(false);

  const filterQuery = () => {
    const qs = new URLSearchParams();
    if (search.trim())      qs.set('barcode', search.trim());
    if (patientName.trim()) qs.set('patient_name', patientName.trim());
    if (orgId)              qs.set('organization_id', String(orgId));
    if (patientId.trim())   qs.set('patient_id', patientId.trim());
    if (fromDate)           qs.set('date_from', fromDate);
    if (toDate)             qs.set('date_to', toDate);
    if (stage)              qs.set('stage', stage);
    return qs;
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/admin/franchises`, { headers: authHeader() })
      .then(r => r.ok ? r.json() : []).then(d => setOrgs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Every finished report in the date range — one PDF per patient — as a ZIP,
  // handed to the share sheet (save to Files / Drive / WhatsApp).
  const downloadZip = async () => {
    if (!fromDate || !toDate) { Alert.alert('Pick dates', 'Choose a From and a To date first.'); return; }
    setZipBusy(true);
    try {
      const qs = filterQuery();
      const uri = (FileSystem.cacheDirectory ?? '') + `Reports_${fromDate}_to_${toDate}.zip`;
      const dl = await FileSystem.downloadAsync(`${API_BASE}/api/results/reports-zip?${qs.toString()}`, uri,
        { headers: { Authorization: `Bearer ${getToken()}` } });
      if (dl.status !== 200) {
        let msg = 'Could not build the ZIP';
        try { const t = await FileSystem.readAsStringAsync(dl.uri); msg = JSON.parse(t).detail || msg; } catch {}
        throw new Error(msg);
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/zip', dialogTitle: 'Reports ZIP' });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) { Alert.alert('Download Zip', String(e?.message || 'Please try again.')); }
    setZipBusy(false);
  };

  const activeFilters = [orgId, patientId.trim(), fromDate, toDate, stage].filter(Boolean).length;
  const clearFilters = () => { setOrgId(null); setPatientId(''); setFromDate(''); setToDate(''); setStage(''); };

  const fetchResults = useCallback(async () => {
    try {
      const qs = filterQuery();
      const url = qs.toString() ? `${API_BASE}/api/results/?${qs.toString()}` : `${API_BASE}/api/results/`;
      const res  = await fetch(url, { headers: authHeader() });
      const data = await res.json();
      setResults(Array.isArray(data) ? data : data.items ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [search, patientName, orgId, patientId, fromDate, toDate, stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLoading(true); fetchResults(); }, [fetchResults]);
  const onRefresh = () => { setRefreshing(true); fetchResults(); };

  const openDetail = (r: Result) => {
    setSel(r); setEditing(false);
    setAttachments([]); setAttachmentsForDl([]);
    if (isOutsourced(r)) fetchAttachmentsForResult(r.id);
  };
  const closeDetail = () => { setSel(null); setEditing(false); };

  const fetchAttachmentsForResult = async (id: number) => {
    setAttLoading(true);
    try {
      // Management list (lab-staff only) — powers upload/delete UI below.
      const mgmtRes = await fetch(`${API_BASE}/api/results/${id}/attachments`, { headers: authHeader() });
      if (mgmtRes.ok) setAttachments(await mgmtRes.json());
      // Any-role read-only list — what the Download button checks/uses.
      const dlRes = await fetch(`${API_BASE}/api/results/attachments-for?ids=${id}`, { headers: authHeader() });
      if (dlRes.ok) setAttachmentsForDl(await dlRes.json());
    } catch (e) { console.error(e); }
    finally { setAttLoading(false); }
  };

  const pickAndUploadAttachment = async () => {
    if (!sel) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
      multiple: true, copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) return;
    setAttUploading(true);
    try {
      const tok = getToken();
      for (const asset of picked.assets) {
        const up = await uploadPickedFile(
          `${API_BASE}/api/results/${sel.id}/attachments`,
          asset.uri, asset.name, asset.mimeType || 'application/octet-stream', tok,
        );
        if (!up.ok) Alert.alert('Error', `Could not upload ${asset.name}`);
      }
      fetchAttachmentsForResult(sel.id);
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setAttUploading(false); }
  };

  const deleteAttachment = (att: Attachment) => {
    if (!sel) return;
    Alert.alert('Remove Attachment', `Remove "${att.filename}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          const res = await fetch(`${API_BASE}/api/results/${sel.id}/attachments/${att.id}`, { method: 'DELETE', headers: authHeader() });
          if (res.ok) fetchAttachmentsForResult(sel.id);
          else Alert.alert('Error', 'Could not remove attachment');
        } catch (e: any) { Alert.alert('Error', e.message); }
      }},
    ]);
  };

  // `url` is a direct public static link — no auth header needed to fetch it.
  const downloadAttachmentFile = async (att: Attachment) => {
    setPdfLoading(att.result_id);
    try {
      const fileUri = FileSystem.cacheDirectory + att.filename;
      const dl = await FileSystem.downloadAsync(att.url, fileUri);
      if (dl.status !== 200) { Alert.alert('Error', 'Attachment not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { dialogTitle: att.filename });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) { Alert.alert('Error', e.message); }
    finally { setPdfLoading(null); }
  };

  const downloadOutsourcedForSel = async () => {
    if (attachmentsForDl.length === 0) return;
    for (const att of attachmentsForDl) await downloadAttachmentFile(att); // sequential — never merged/zipped
  };

  const [calcBusy, setCalcBusy]   = useState(false);
  const [calcDirty, setCalcDirty] = useState(false);   // a value was edited since the last Calculate

  const startEdit = () => {
    if (!sel) return;
    setEditParams((sel.parsed_data?.parameters ?? []).map(p => ({ ...p })));
    setEditNote(sel.note ?? '');
    setCalcDirty(false);
    setEditing(true);
  };
  const cancelEdit = () => setEditing(false);

  const setParamValue = (i: number, v: string) => {
    setCalcDirty(true);
    setEditParams(prev => prev.map((p, idx) => idx === i ? { ...p, value: v } : p));
  };
  const setParamFlag = (i: number, flag: string) =>   // a hand-picked flag survives Calculate
    setEditParams(prev => prev.map((p, idx) => idx === i ? { ...p, flag, flag_manual: true } : p));

  // Recompute VLDL / lipid ratios from the values as typed (nothing is saved until Save).
  const calculate = async () => {
    if (!sel) return;
    setCalcBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/results/${sel.id}/calculate`, {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: editParams.map(toPayload) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? 'Calculate failed');
      setEditParams(data.parameters);
      setCalcDirty(false);
    } catch (e: any) { Alert.alert('Calculate', e.message); }
    finally { setCalcBusy(false); }
  };

  const saveEdit = async () => {
    if (!sel) return;
    setSaving(true);
    try {
      const payload = {
        parameters: editParams.map(toPayload),
        note: editNote,
      };
      const res  = await fetch(`${API_BASE}/api/results/${sel.id}`, {
        method: 'PUT',
        headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? 'Could not save changes');
      const merged: Result = {
        ...sel,
        parsed_data: data.parsed_data ?? sel.parsed_data,
        note: data.note ?? editNote,
      };
      setSel(merged);
      setResults(prev => prev.map(r => r.id === merged.id ? merged : r));
      setEditing(false);
      Alert.alert('✅ Saved', 'Result updated');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setSaving(false); }
  };

  // Download PDF with auth token → share sheet. `withHeader` maps to the
  // shared backend's ?with_header=true|false — false is for printing on
  // pre-printed letterhead paper (skips logo/address header, footer band,
  // watermark, but preserves the same layout/spacing).
  const viewPDF = async (r: Result, withHeader: boolean) => {
    if (!r.id) { Alert.alert('Error', 'No report id'); return; }
    setPdfLoading(r.id);
    try {
      const tok = getToken();
      const suffix = withHeader ? '' : '_noheader';
      const fileUri = FileSystem.cacheDirectory + `Report_${r.barcode}_${r.id}${suffix}.pdf`;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/results/${r.id}/pdf?with_header=${withHeader}`, fileUri,
        { headers: { Authorization: `Bearer ${tok}` } }
      );
      if (dl.status !== 200) { Alert.alert('Error', 'Report not accessible'); return; }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Report ${r.barcode}` });
      } else { Alert.alert('Saved', dl.uri); }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setPdfLoading(null); }
  };

  // Mobile's equivalent of the web split-button: an action sheet offering
  // both header variants. Tapping the button always asks — simpler and more
  // discoverable on touch than a hidden dropdown arrow.
  const chooseHeaderThenDownload = (r: Result) => {
    Alert.alert(
      'Download PDF',
      'Choose a layout for this report.',
      [
        { text: 'With Header', onPress: () => viewPDF(r, true) },
        { text: 'Without Header (for letterhead paper)', onPress: () => viewPDF(r, false) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  // Combine every result sharing this barcode into one PDF, PLUS separately
  // download/share any outsourced attachments among them — never merged into
  // the report itself, always as their own individual shared files.
  const downloadCombined = async (barcode: string, withHeader: boolean) => {
    const group = results.filter(r => r.barcode === barcode);
    const ids = group.map(r => r.id);
    if (ids.length === 0) return;
    const inHouseIds    = group.filter(r => !isOutsourced(r)).map(r => r.id);
    const outsourcedIds = group.filter(r => isOutsourced(r)).map(r => r.id);
    setCombineLoading(true);
    try {
      // 1) Combined report — only if there's at least one in-house test.
      // (The backend already silently drops outsourced ids from this PDF;
      // skipping the call entirely when NONE are in-house avoids downloading
      // an empty/meaningless report.)
      if (inHouseIds.length > 0) {
        const tok = getToken();
        const suffix = withHeader ? '' : '_noheader';
        const fileUri = FileSystem.cacheDirectory + `Reports_${barcode}${suffix}.pdf`;
        const dl = await FileSystem.downloadAsync(
          `${API_BASE}/api/results/combined-pdf?ids=${ids.join(',')}&with_header=${withHeader}`, fileUri,
          { headers: { Authorization: `Bearer ${tok}` } }
        );
        if (dl.status === 200) {
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(dl.uri, { mimeType: 'application/pdf', dialogTitle: `Reports ${barcode}` });
          } else { Alert.alert('Saved', dl.uri); }
        } else {
          Alert.alert('Error', 'Could not download combined report');
        }
      }
      // 2) Outsourced attachments among this group — separate files, sequential shares.
      if (outsourcedIds.length > 0) {
        const attRes = await fetch(`${API_BASE}/api/results/attachments-for?ids=${outsourcedIds.join(',')}`, { headers: authHeader() });
        const atts: Attachment[] = attRes.ok ? await attRes.json() : [];
        for (const att of atts) await downloadAttachmentFile(att);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally { setCombineLoading(false); }
  };

  const chooseHeaderThenDownloadCombined = (barcode: string) => {
    Alert.alert(
      'Combine & Download',
      'Choose a layout for the combined report.',
      [
        { text: 'With Header', onPress: () => downloadCombined(barcode, true) },
        { text: 'Without Header (for letterhead paper)', onPress: () => downloadCombined(barcode, false) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const renderItem = ({ item: r }: { item: Result }) => {
    const life  = r.lifecycle_status ?? r.status;
    const color = STATUS_COLOR[life] ?? '#64748B';
    return (
      <TouchableOpacity style={styles.card} onPress={() => openDetail(r)} activeOpacity={0.8}>
        <View style={styles.cardRow}>
          <Text style={styles.barcode}>📋 {r.barcode}{r.accession_number ? <Text style={styles.accessionInline}> · {r.accession_number}</Text> : null}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {isOutsourced(r) && (
              <View style={[styles.badge, { borderColor: '#8B5CF6' }]}>
                <Text style={[styles.badgeText, { color: '#8B5CF6' }]}>📤 OUTSOURCED</Text>
              </View>
            )}
            <View style={[styles.badge, { borderColor: color }]}>
              <Text style={[styles.badgeText, { color }]}>● {life}</Text>
            </View>
          </View>
        </View>
        <Text style={styles.name}>{r.patient_name}</Text>
        {r.test_name && <Text style={styles.testName}>🧪 {r.test_name}</Text>}
        <Text style={styles.date}>🕐 {fmtDateTime(r.created_at)}{r.device_name ? ` · ${r.device_name}` : ''}</Text>
        <Text style={styles.tapHint}>Tap for details ›</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.searchWrap}>
        <TextInput style={styles.search} value={search} onChangeText={setSearch}
          placeholder="🔍  Search by barcode..." placeholderTextColor="#475569"
          onSubmitEditing={fetchResults} returnKeyType="search" />
        <TextInput style={[styles.search, { marginTop: 8 }]} value={patientName} onChangeText={setPatientName}
          placeholder="🔍  Search by patient name..." placeholderTextColor="#475569"
          onSubmitEditing={fetchResults} returnKeyType="search" />

        <TouchableOpacity style={styles.moreBtn} onPress={() => setShowFilters(v => !v)}>
          <Text style={styles.moreText}>{showFilters ? '▾' : '▸'}  More filters & Download Zip{activeFilters ? `  ·  ${activeFilters} on` : ''}</Text>
        </TouchableOpacity>
        {showFilters && (
          <View style={styles.filterBox}>
            <View style={styles.fRow}>
              <TouchableOpacity style={[styles.fInput, { flex: 1 }]} onPress={() => setPicker('org')}>
                <Text style={{ color: orgId ? '#0F172A' : '#64748B', fontSize: 13 }} numberOfLines={1}>
                  {orgId ? orgLabel(orgs.find(o => o.id === orgId) || {}) : 'All organizations'}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fRow}>
              <TouchableOpacity style={[styles.fInput, { flex: 1 }]} onPress={() => setPicker('from')}>
                <Text style={{ color: fromDate ? '#0F172A' : '#64748B', fontSize: 13 }}>{fromDate || 'From date'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.fInput, { flex: 1 }]} onPress={() => setPicker('to')}>
                <Text style={{ color: toDate ? '#0F172A' : '#64748B', fontSize: 13 }}>{toDate || 'To date'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fRow}>
              <TextInput style={[styles.fInput, { flex: 1 }]} value={patientId} onChangeText={setPatientId}
                placeholder="Patient ID" placeholderTextColor="#64748B" keyboardType="number-pad" />
              <TouchableOpacity style={[styles.fInput, { flex: 1 }]} onPress={() => setPicker('stage')}>
                <Text style={{ color: stage ? '#0F172A' : '#64748B', fontSize: 13, textTransform: 'capitalize' }}>{stage || 'Status: all'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.fRow}>
              {activeFilters > 0 && (
                <TouchableOpacity style={styles.clearBtn} onPress={clearFilters}>
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.zipBtn, (!fromDate || !toDate) && { opacity: 0.55 }]} onPress={downloadZip} disabled={zipBusy}>
                {zipBusy ? <ActivityIndicator color="#0E7D6B" /> : <Text style={styles.zipText}>🗜️  Download Zip</Text>}
              </TouchableOpacity>
            </View>
            <Text style={styles.fHint}>Download Zip: every finished report between the dates, one PDF per patient.</Text>
          </View>
        )}
      </View>

      {(picker === 'from' || picker === 'to') && (
        <DateTimePicker
          value={(picker === 'from' ? fromDate : toDate) ? new Date(picker === 'from' ? fromDate : toDate) : new Date()}
          mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_e, d) => { const w = picker; setPicker(null); if (d) (w === 'from' ? setFromDate : setToDate)(toYMD(d)); }}
        />
      )}
      <Modal visible={picker === 'org' || picker === 'stage'} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.pOverlay}>
          <View style={styles.pBox}>
            <Text style={styles.pTitle}>{picker === 'org' ? 'Organization' : 'Status'}</Text>
            {picker === 'org' && (
              <TextInput style={[styles.fInput, { marginBottom: 8 }]} value={orgQuery} onChangeText={setOrgQuery}
                placeholder="Type code or name…" placeholderTextColor="#64748B" />
            )}
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {picker === 'org' && (
                <>
                  <TouchableOpacity style={styles.pItem} onPress={() => { setOrgId(null); setPicker(null); setOrgQuery(''); }}>
                    <Text style={styles.pText}>All organizations</Text>
                  </TouchableOpacity>
                  {orgs.map(o => ({ o, l: orgLabel(o) }))
                    .filter(x => !orgQuery.trim() || x.l.toLowerCase().includes(orgQuery.trim().toLowerCase()))
                    .sort((a, b) => a.l.localeCompare(b.l))
                    .map(({ o, l }) => (
                      <TouchableOpacity key={o.id} style={[styles.pItem, orgId === o.id && styles.pItemOn]}
                        onPress={() => { setOrgId(o.id); setPicker(null); setOrgQuery(''); }}>
                        <Text style={styles.pText}>{l}</Text>
                      </TouchableOpacity>
                    ))}
                </>
              )}
              {picker === 'stage' && STAGES.map(s => (
                <TouchableOpacity key={s || 'all'} style={[styles.pItem, stage === s && styles.pItemOn]} onPress={() => { setStage(s); setPicker(null); }}>
                  <Text style={[styles.pText, { textTransform: 'capitalize' }]}>{s || 'All'}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.pCancel} onPress={() => setPicker(null)}>
              <Text style={styles.pCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {loading ? <ActivityIndicator color="#17B9A1" size="large" style={{ marginTop: 48 }} /> : (
        <FlatList data={results} keyExtractor={(r, i) => (r.id ?? i).toString()} renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#17B9A1" />}
          ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyIcon}>📋</Text><Text style={styles.emptyText}>No results found</Text></View>}
        />
      )}

      {/* Detail modal — mirrors the web "Lab Report" side panel, with Edit */}
      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.overlay}>
          <View style={styles.modalBox}>
            {sel && (
              <>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Lab Report</Text>
                    <Text style={styles.modalSub}>Result #{sel.id}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                    {!editing && (
                      <TouchableOpacity onPress={startEdit}>
                        <Text style={styles.editLink}>✎ Edit</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={closeDetail} style={styles.closeX}>
                      <Text style={styles.closeXText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.infoGrid}>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoLabel}>PATIENT</Text>
                      <Text style={styles.infoVal}>{sel.patient_name}</Text>
                    </View>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoLabel}>BARCODE</Text>
                      <Text style={styles.infoVal}>{sel.barcode}</Text>
                    </View>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoLabel}>ACCESSION NO.</Text>
                      <Text style={[styles.infoVal, { color: '#F97316' }]}>{sel.accession_number ?? '—'}</Text>
                    </View>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoLabel}>DEVICE</Text>
                      <Text style={styles.infoVal}>{sel.device_name ?? '—'}</Text>
                    </View>
                    <View style={styles.infoBox}>
                      <Text style={styles.infoLabel}>PROTOCOL</Text>
                      <Text style={styles.infoVal}>{sel.parsed_data?.protocol ?? '—'}</Text>
                    </View>
                  </View>

                  <Text style={styles.paramTitle}>PARAMETERS ({(editing ? editParams : sel.parsed_data?.parameters ?? []).length})</Text>

                  {!editing && (sel.parsed_data?.parameters ?? []).map((p, i) => {
                    const flag = p.flag === 'H' || p.flag === 'L';
                    return (
                      <View key={i} style={styles.paramRow}>
                        <Text style={styles.paramName}>{p.name}</Text>
                        <Text style={[styles.paramValue, flag && { color: '#EF4444', fontWeight: '700' }]}>
                          {p.value}{p.unit ? ` ${p.unit}` : ''}{p.flag ? ` ${p.flag === 'H' ? '↑' : '↓'}` : ''}
                        </Text>
                        {(p.ref_min != null || p.ref_max != null) && (
                          <Text style={styles.paramRef}>{p.ref_min}–{p.ref_max}</Text>
                        )}
                      </View>
                    );
                  })}

                  {editing && (
                  <View style={styles.calcRow}>
                    {calcDirty && <Text style={styles.calcHint}>Values changed — tap Calculate to refresh VLDL / ratios</Text>}
                    <TouchableOpacity style={[styles.calcBtn, calcDirty && styles.calcBtnOn]} onPress={calculate} disabled={calcBusy}>
                      {calcBusy ? <ActivityIndicator size="small" color={calcDirty ? '#fff' : '#C2410C'} />
                        : <Text style={[styles.calcBtnText, calcDirty && { color: '#fff' }]}>🧮 Calculate</Text>}
                    </TouchableOpacity>
                  </View>
                  )}
                  {editing && editParams.map((p, i) => (
                    <View key={i} style={styles.editParamRow}>
                      <Text style={styles.editParamName}>{p.name}{p.calculated ? <Text style={styles.calcTag}>  · calculated</Text> : null}</Text>
                      <TextInput style={styles.editParamInput} value={String(p.value)}
                        onChangeText={v => setParamValue(i, v)} keyboardType="numeric" />
                      <View style={styles.flagPicker}>
                        {FLAG_OPTIONS.map(opt => (
                          <TouchableOpacity key={opt.value} style={[styles.flagOpt, p.flag === opt.value && styles.flagOptSel]}
                            onPress={() => setParamFlag(i, opt.value)}>
                            <Text style={[styles.flagOptText, p.flag === opt.value && styles.flagOptTextSel]}>{opt.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.editParamRef}>{p.unit ?? ''} · {p.ref_min}–{p.ref_max}</Text>
                    </View>
                  ))}

                  {editing && (
                    <>
                      <Text style={styles.noteLabel}>NOTE (shown at the end of the report if filled in)</Text>
                      <TextInput style={styles.noteInput} value={editNote} onChangeText={setEditNote}
                        placeholder="e.g. Sample slightly hemolysed; recommend repeat in 2 weeks"
                        placeholderTextColor="#94A3B8" multiline numberOfLines={3} />
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                        <TouchableOpacity style={[styles.saveBtn, { flex: 1 }]} onPress={saveEdit} disabled={saving}>
                          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>✓ Save Changes</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancelEditBtn} onPress={cancelEdit} disabled={saving}>
                          <Text style={styles.cancelEditBtnText}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}

                  {isOutsourced(sel) && (
                    <>
                      <Text style={styles.paramTitle}>ATTACHMENTS ({attachments.length})</Text>
                      {attLoading ? <ActivityIndicator color="#8B5CF6" style={{ marginVertical: 10 }} /> : (
                        <>
                          {attachments.length === 0 && (
                            <Text style={styles.attEmpty}>No attachment uploaded yet from the external lab.</Text>
                          )}
                          {attachments.map(att => (
                            <View key={att.id} style={styles.attRow}>
                              <TouchableOpacity style={{ flex: 1 }} onPress={() => downloadAttachmentFile(att)}>
                                <Text style={styles.attName} numberOfLines={1}>📎 {att.filename}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => deleteAttachment(att)} style={styles.attRemoveBtn}>
                                <Text style={styles.attRemoveText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          <TouchableOpacity style={styles.attAddBtn} onPress={pickAndUploadAttachment} disabled={attUploading}>
                            {attUploading
                              ? <ActivityIndicator color="#8B5CF6" size="small" />
                              : <Text style={styles.attAddBtnText}>+ Add Attachment (PDF/PNG/JPG/WEBP, ≤15MB)</Text>}
                          </TouchableOpacity>
                        </>
                      )}
                    </>
                  )}

                  {!editing && (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                      {results.filter(r => r.barcode === sel.barcode).length > 1 && (
                        <TouchableOpacity style={[styles.pdfBtn, styles.combineBtn, { flex: 1 }]}
                          onPress={() => chooseHeaderThenDownloadCombined(sel.barcode)} disabled={combineLoading}>
                          <Text style={styles.combineBtnText} numberOfLines={1}>
                            {combineLoading ? 'Loading…' : `🔗 Combine (${results.filter(r => r.barcode === sel.barcode).length})`}
                          </Text>
                        </TouchableOpacity>
                      )}
                      {isOutsourced(sel) ? (
                        <TouchableOpacity
                          style={[styles.pdfBtn, { flex: 1, marginTop: 0 }, attachmentsForDl.length === 0 && styles.pdfBtnDisabled]}
                          onPress={downloadOutsourcedForSel}
                          disabled={attachmentsForDl.length === 0 || pdfLoading === sel.id}>
                          <Text style={styles.pdfBtnText} numberOfLines={1}>
                            {pdfLoading === sel.id ? 'Loading…' : attachmentsForDl.length === 0 ? '📎 No Attachment Yet' : `📎 Download Attachment${attachmentsForDl.length > 1 ? 's' : ''}`}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={[styles.pdfBtn, { flex: 1, marginTop: 0 }]} onPress={() => chooseHeaderThenDownload(sel)} disabled={pdfLoading === sel.id}>
                          <Text style={styles.pdfBtnText} numberOfLines={1}>{pdfLoading === sel.id ? 'Loading…' : '📄 Download PDF'}</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                  <View style={{ height: 8 }} />
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: '#F8FAFC' },
  searchWrap:     { padding: 12 },
  moreBtn:        { marginTop: 8, paddingVertical: 6 },
  moreText:       { color: '#0E7D6B', fontSize: 12.5, fontWeight: '700' },
  filterBox:      { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 10, gap: 8 },
  fRow:           { flexDirection: 'row', gap: 8, alignItems: 'center' },
  fInput:         { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 10, borderRadius: 9, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0', justifyContent: 'center' },
  clearBtn:       { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 9, borderWidth: 1, borderColor: '#E2E8F0' },
  clearText:      { color: '#EF4444', fontWeight: '700', fontSize: 12.5 },
  zipBtn:         { flex: 1, paddingVertical: 10, borderRadius: 9, borderWidth: 1.5, borderColor: '#0E7D6B', alignItems: 'center' },
  zipText:        { color: '#0E7D6B', fontWeight: '700', fontSize: 13 },
  fHint:          { color: '#94A3B8', fontSize: 10.5 },
  pOverlay:       { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  pBox:           { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  pTitle:         { color: '#0F172A', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  pItem:          { padding: 13, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#E2E8F0' },
  pItemOn:        { borderColor: '#17B9A1', backgroundColor: '#17B9A115' },
  pText:          { color: '#0F172A', fontSize: 14 },
  pCancel:        { marginTop: 8, padding: 14, borderRadius: 10, backgroundColor: '#F8FAFC', alignItems: 'center' },
  pCancelText:    { color: '#EF4444', fontWeight: '700' },
  search:         { backgroundColor: '#FFFFFF', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  card:           { backgroundColor: '#FFFFFF', marginHorizontal: 12, marginBottom: 10, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  cardRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  barcode:        { color: '#64748B', fontSize: 12 },
  accessionInline:{ color: '#F97316', fontSize: 12, fontWeight: '700' },
  badge:          { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  badgeText:      { fontSize: 11, fontWeight: '700' },
  name:           { color: '#0F172A', fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  testName:       { color: '#60A5FA', fontSize: 13, marginBottom: 4 },
  date:           { color: '#475569', fontSize: 11 },
  tapHint:        { color: '#475569', fontSize: 11, marginTop: 8 },
  empty:          { alignItems: 'center', marginTop: 60 },
  emptyIcon:      { fontSize: 48 },
  emptyText:      { color: '#475569', fontSize: 16, marginTop: 12 },
  overlay:        { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  modalBox:       { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28 },
  modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  modalTitle:     { color: '#0F172A', fontSize: 18, fontWeight: 'bold' },
  modalSub:       { color: '#64748B', fontSize: 12, marginTop: 2 },
  editLink:       { color: '#17B9A1', fontSize: 13, fontWeight: '700' },
  closeX:         { padding: 6 },
  closeXText:     { color: '#64748B', fontSize: 16 },
  infoGrid:       { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#F8FAFC', borderRadius: 10, padding: 12, gap: 14 },
  infoBox:        { width: '45%' },
  infoLabel:      { color: '#475569', fontSize: 10, fontWeight: '700', marginBottom: 3 },
  infoVal:        { color: '#0F172A', fontSize: 13, fontWeight: '600' },
  paramTitle:     { color: '#475569', fontSize: 11, fontWeight: '700', marginTop: 16, marginBottom: 6, textTransform: 'uppercase' },
  paramRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F8FAFC' },
  paramName:      { flex: 1, color: '#94A3B8', fontSize: 12 },
  paramValue:     { color: '#0F172A', fontSize: 13, fontWeight: '600', marginRight: 8 },
  paramRef:       { color: '#475569', fontSize: 10, width: 60, textAlign: 'right' },
  calcRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  calcHint:       { color: '#C2410C', fontSize: 11, fontWeight: '700', flexShrink: 1 },
  calcBtn:        { borderWidth: 1, borderColor: '#F9731666', backgroundColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  calcBtnOn:      { backgroundColor: '#F97316', borderColor: '#F97316' },
  calcBtnText:    { color: '#C2410C', fontWeight: '700', fontSize: 12.5 },
  calcTag:        { color: '#C2410C', fontSize: 10, fontWeight: '700' },
  editParamRow:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  editParamName:  { color: '#0F172A', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  editParamInput: { backgroundColor: '#F8FAFC', color: '#0F172A', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, fontSize: 13, fontWeight: '700', borderWidth: 1.5, borderColor: '#17B9A1', marginBottom: 6 },
  flagPicker:     { flexDirection: 'row', gap: 6, marginBottom: 6 },
  flagOpt:        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  flagOptSel:     { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  flagOptText:    { color: '#64748B', fontSize: 11, fontWeight: '600' },
  flagOptTextSel: { color: '#EF4444' },
  editParamRef:   { color: '#94A3B8', fontSize: 11 },
  noteLabel:      { color: '#475569', fontSize: 11, fontWeight: '700', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' },
  noteInput:      { backgroundColor: '#F8FAFC', color: '#0F172A', padding: 12, borderRadius: 10, fontSize: 13, borderWidth: 1, borderColor: '#E2E8F0', minHeight: 70, textAlignVertical: 'top' },
  saveBtn:        { backgroundColor: '#10B981', padding: 13, borderRadius: 10, alignItems: 'center' },
  saveBtnText:    { color: '#fff', fontSize: 13, fontWeight: '700' },
  cancelEditBtn:  { paddingHorizontal: 18, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  cancelEditBtnText: { color: '#64748B', fontSize: 13, fontWeight: '600' },
  pdfBtn:         { backgroundColor: '#F97316', padding: 13, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  pdfBtnText:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  combineBtn:     { backgroundColor: '#6366F115', borderWidth: 1, borderColor: '#6366f1' },
  combineBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '700' },
  pdfBtnDisabled: { backgroundColor: '#CBD5E1' },
  attEmpty:       { color: '#94A3B8', fontSize: 12, marginBottom: 8 },
  attRow:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, borderWidth: 1, borderColor: '#E2E8F0' },
  attName:        { color: '#3B82F6', fontSize: 13, fontWeight: '600' },
  attRemoveBtn:   { paddingHorizontal: 8 },
  attRemoveText:  { color: '#EF4444', fontSize: 14, fontWeight: '700' },
  attAddBtn:      { backgroundColor: '#8B5CF615', borderWidth: 1, borderColor: '#8B5CF644', borderStyle: 'dashed', borderRadius: 8, padding: 12, alignItems: 'center', marginBottom: 4 },
  attAddBtnText:  { color: '#8B5CF6', fontSize: 12, fontWeight: '600' },
});
