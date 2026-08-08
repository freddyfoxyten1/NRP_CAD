// ─────────────────────────────────────────────────────────────────────────────
// lib/docx-to-pdf.ts  —  Local DOCX → PDF conversion via LibreOffice
//
// Converts an in-memory .docx buffer to a PDF buffer using the headless
// LibreOffice binary (`soffice`) installed in the environment. All work
// happens in a throwaway temp directory that is always cleaned up.
// ─────────────────────────────────────────────────────────────────────────────
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionError";
  }
}

const PDF_MAGIC = Buffer.from("%PDF");
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04"
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]); // legacy .doc

export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 4).equals(PDF_MAGIC);
}

/** True when the buffer looks like a real .docx (a ZIP containing [Content_Types].xml). */
export function isDocx(buf: Buffer): boolean {
  if (!buf.subarray(0, 4).equals(ZIP_MAGIC)) return false;
  // The OOXML content-types entry is stored near the start of the archive.
  return buf.includes("[Content_Types].xml");
}

/** True for legacy binary Word files (.doc) — explicitly unsupported. */
export function isLegacyDoc(buf: Buffer): boolean {
  return buf.subarray(0, 4).equals(OLE_MAGIC);
}

function runSoffice(args: string[], cwd: string, home: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "soffice",
      args,
      { cwd, timeout: 90_000, env: { ...process.env, HOME: home } },
      (err, stdout, stderr) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * Convert a DOCX buffer to a PDF buffer.
 * Throws ConversionError with a user-friendly message on failure
 * (corrupted, password-protected, or unsupported documents).
 */
export async function convertDocxToPdf(docx: Buffer): Promise<Buffer> {
  if (docx.length === 0) throw new ConversionError("The uploaded document is empty.");

  const workDir = await mkdtemp(path.join(tmpdir(), "docx2pdf-"));
  try {
    const inputPath = path.join(workDir, "input.docx");
    await writeFile(inputPath, docx);

    try {
      // A dedicated HOME keeps LibreOffice profiles isolated between runs.
      await runSoffice(
        ["--headless", "--norestore", "--convert-to", "pdf", "--outdir", workDir, inputPath],
        workDir,
        workDir,
      );
    } catch (err) {
      const detail = err instanceof Error ? `${err.message} ${(err as { stderr?: string }).stderr ?? ""}` : String(err);
      if (/password/i.test(detail)) {
        throw new ConversionError("This document is password-protected. Remove the password and try again.");
      }
      throw new ConversionError("Could not convert this Word document. It may be corrupted or use an unsupported format.");
    }

    const pdf = await readFile(path.join(workDir, "input.pdf")).catch(() => null);
    if (!pdf || !isPdf(pdf)) {
      throw new ConversionError("Conversion produced no valid PDF. The document may be corrupted or password-protected.");
    }
    return pdf;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
