/**
 * Excel in and out for a Tests Catalog tab, on the phone.
 *
 * Nothing is parsed on the device: the server builds the workbook and reads it
 * back, so this only moves bytes. That is why it needs no new package — the
 * download, share and file-pick helpers are the ones the app already uses for
 * report PDFs and result attachments.
 *
 * An upload is always validated first with dry_run, so the lab sees "3 new, 12
 * updated" and can still back out. Nothing is written until they confirm, and a
 * sheet with any error at all writes nothing.
 */
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  Alert, Modal, ScrollView,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { API_BASE, getToken } from '../utils/auth';
import { uploadPickedFile } from '../utils/uploadPickedFile';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type CatalogKind = 'tests' | 'test-groups' | 'reference-ranges';

type Busy = '' | 'export' | 'sample' | 'import';

export default function CatalogExcel({
  kind, noun, onDone,
}: { kind: CatalogKind; noun: string; onDone?: () => void }) {
  const [busy, setBusy] = useState<Busy>('');
  const [errors, setErrors] = useState<{ message: string; list: string[]; more: number } | null>(null);

  // ---------------------------------------------------------------- download
  const download = async (which: 'export' | 'sample') => {
    if (busy) return;
    setBusy(which);
    try {
      const name = which === 'sample' ? `${kind}-SAMPLE.xlsx` : `${kind}.xlsx`;
      const dest = FileSystem.cacheDirectory + name;
      const dl = await FileSystem.downloadAsync(
        `${API_BASE}/api/catalog-xlsx/${which}/${kind}`, dest,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      if (dl.status !== 200) {
        Alert.alert('Could not download', `The server answered ${dl.status}.`);
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(dl.uri, {
          mimeType: XLSX_MIME,
          dialogTitle: which === 'sample' ? `${noun} — sample file` : noun,
        });
      } else {
        Alert.alert('Saved', dl.uri);
      }
    } catch (e: any) {
      Alert.alert('Could not download', e?.message ?? 'Please try again.');
    } finally {
      setBusy('');
    }
  };

  // ------------------------------------------------------------------ upload
  const send = async (uri: string, filename: string, dry: boolean) => {
    const res = await uploadPickedFile(
      `${API_BASE}/api/catalog-xlsx/import/${kind}?dry_run=${dry}`,
      uri, filename, XLSX_MIME, getToken(),
    );
    let body: any = null;
    try { body = JSON.parse(res.body); } catch { /* keep null */ }
    return { ok: res.ok, body };
  };

  const showErrors = (body: any) => {
    const d = body?.detail;
    if (typeof d === 'string') { setErrors({ message: d, list: [], more: 0 }); return; }
    const list: string[] = d?.errors ?? [];
    setErrors({
      message: d?.message ?? 'That file could not be read',
      list,
      more: Math.max(0, (d?.error_count ?? list.length) - list.length),
    });
  };

  const pickAndImport = async () => {
    if (busy) return;
    const picked = await DocumentPicker.getDocumentAsync({
      type: [XLSX_MIME, 'application/octet-stream'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];

    setBusy('import');
    const dry = await send(asset.uri, asset.name ?? 'sheet.xlsx', true);
    setBusy('');
    if (!dry.ok) { showErrors(dry.body); return; }

    const created = dry.body?.created ?? 0;
    const updated = dry.body?.updated ?? 0;
    if (!created && !updated) {
      Alert.alert('Nothing to import', 'That sheet has no rows.');
      return;
    }

    Alert.alert(
      `Import ${noun}?`,
      `${created} will be added.\n${updated} will be updated.\n\n` +
      'Nothing is deleted — anything missing from the sheet is left as it is.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Import',
          onPress: async () => {
            setBusy('import');
            const real = await send(asset.uri, asset.name ?? 'sheet.xlsx', false);
            setBusy('');
            if (!real.ok) { showErrors(real.body); return; }
            Alert.alert('Done', real.body?.message ?? 'Imported.');
            onDone?.();
          },
        },
      ],
    );
  };

  // -------------------------------------------------------------------- view
  const Btn = ({ label, on, press, dashed }: {
    label: string; on: boolean; press: () => void; dashed?: boolean;
  }) => (
    <TouchableOpacity
      style={[styles.btn, dashed && styles.btnDashed, !!busy && styles.btnOff]}
      onPress={press}
      disabled={!!busy}
      activeOpacity={0.75}
    >
      {on ? <ActivityIndicator size="small" color="#64748B" />
          : <Text style={styles.btnText}>{label}</Text>}
    </TouchableOpacity>
  );

  return (
    <>
      <View style={styles.row}>
        <Btn label="⭳  Export"  on={busy === 'export'} press={() => download('export')} />
        <Btn label="◳  Sample"  on={busy === 'sample'} press={() => download('sample')} dashed />
        <Btn label="⭱  Import"  on={busy === 'import'} press={pickAndImport} />
      </View>

      <Modal visible={!!errors} transparent animationType="fade" onRequestClose={() => setErrors(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Nothing was imported</Text>
            <Text style={styles.sub}>
              {errors?.message}
              {errors?.more ? ` (showing the first ${errors.list.length} of ${errors.list.length + errors.more})` : ''}
            </Text>
            <ScrollView style={{ maxHeight: 280 }}>
              {errors?.list.map((e, i) => (
                <Text key={i} style={styles.err}>•  {e}</Text>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.close} onPress={() => setErrors(null)}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row:       { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  btn:       { flex: 1, backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#E2E8F0',
               borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  btnDashed: { borderStyle: 'dashed', borderColor: '#D7DFEA' },
  btnOff:    { opacity: 0.55 },
  btnText:   { color: '#55617A', fontWeight: '700', fontSize: 12.5 },

  overlay:   { flex: 1, backgroundColor: 'rgba(15,18,24,0.45)', justifyContent: 'center', padding: 20 },
  sheet:     { backgroundColor: '#fff', borderRadius: 16, padding: 20 },
  title:     { fontSize: 17, fontWeight: '800', color: '#0F1218', marginBottom: 4 },
  sub:       { fontSize: 13, color: '#8892A4', marginBottom: 12, lineHeight: 19 },
  err:       { fontSize: 12.5, color: '#B91C1C', lineHeight: 20, marginBottom: 2 },
  close:     { marginTop: 16, alignSelf: 'flex-end', backgroundColor: '#F97316',
               borderRadius: 10, paddingVertical: 10, paddingHorizontal: 22 },
  closeText: { color: '#fff', fontWeight: '700' },
});
