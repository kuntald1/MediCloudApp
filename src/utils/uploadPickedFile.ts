import { File, UploadType } from 'expo-file-system';

// Uploads a file picked via expo-document-picker / expo-image-picker.
//
// This is the 4th approach tried for file uploads in this app, and — unlike
// the previous three — it's built directly from Expo's own current
// documentation example for "picking a file, then uploading it":
//   1. new FormData(); fd.append('file', { uri, name, type })
//        → threw "Unsupported FormDataPart implementation" on this RN version.
//   2. FileSystem.uploadAsync (expo-file-system/legacy)
//        → threw "isn't readable" reading the document-picker cache URI.
//   3. fetch(uri).blob() appended to FormData
//        → threw "undefined is not a function" (RN's built-in Blob is
//          incomplete — the runtime itself suggested installing expo-blob).
//   4. This one: expo-file-system's modern `File` class implements the Blob
//      interface natively and ships a purpose-built `.upload()` method, so
//      there's no manual FormData/Blob assembly happening in our code at all.
export async function uploadPickedFile(
  url: string,
  fileUri: string,
  filename: string,
  mimeType: string,
  token: string | null,
  extraFields?: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const file = new File(fileUri);
  const result = await file.upload(url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType,
    parameters: { filename, ...(extraFields ?? {}) },
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { ok: result.status >= 200 && result.status < 300, status: result.status, body: result.body };
}
