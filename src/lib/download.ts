const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Blob makes its own immutable snapshot. A typed-array view avoids a second
 * full document copy and respects subarray offsets; it never detaches input. */
export function createDocxBlob(bytes: Uint8Array): Blob {
  const buffer = bytes.buffer;
  const part =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer, bytes.byteOffset, bytes.byteLength)
      : Uint8Array.from(bytes).buffer;
  return new Blob([part], { type: DOCX_MIME });
}
