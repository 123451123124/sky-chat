import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size exceeds 10MB limit' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Extract text from PDF using pdfjs-dist with worker set via file:// URL
    let textContent = '';
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
      // Set worker to the actual worker file using file:// URL
      // This avoids Turbopack's module resolution issues
      const workerPath =
        'file:///' +
        process.cwd().replace(/\\/g, '/') +
        '/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs';
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerPath;

      const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
          .filter((item: Record<string, unknown>) => 'str' in item)
          .map((item: Record<string, unknown>) => (item.str as string) || '')
          .join(' ');
        textContent += pageText + '\n';
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      console.error('PDF parse error:', message);
      return NextResponse.json(
        { error: 'Failed to parse PDF', detail: message },
        { status: 422 }
      );
    }

    return NextResponse.json({
      fileName: file.name,
      textContent,
      fileSize: file.size,
    });
  } catch {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
