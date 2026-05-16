import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml',
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h',
  'html', 'htm', 'css', 'scss', 'less',
  'sh', 'bash', 'zsh', 'ps1',
  'sql', 'graphql',
  'toml', 'ini', 'cfg', 'env', 'gitignore',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5MB for images

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

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

    const ext = getExtension(file.name);
    const isPdf = file.type === 'application/pdf' || ext === 'pdf';
    const isText = TEXT_EXTENSIONS.has(ext);
    const isImage = IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/');

    if (!isPdf && !isText && !isImage) {
      return NextResponse.json(
        { error: `Unsupported file type: ${ext || file.type}. Supported: PDF, text/code files, images` },
        { status: 400 }
      );
    }

    const sizeLimit = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
    if (file.size > sizeLimit) {
      return NextResponse.json(
        { error: `File size exceeds ${sizeLimit / 1024 / 1024}MB limit` },
        { status: 400 }
      );
    }

    if (isPdf) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      let textContent = '';
      try {
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
    }

    if (isImage) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = file.type || `image/${ext}`;
      const dataUrl = `data:${mimeType};base64,${base64}`;

      return NextResponse.json({
        fileName: file.name,
        textContent: `[图片: ${file.name}]`,
        fileSize: file.size,
        imageDataUrl: dataUrl,
      });
    }

    // Text / code file — read directly
    const textContent = await file.text();
    return NextResponse.json({
      fileName: file.name,
      textContent,
      fileSize: file.size,
    });
  } catch (e) {
    console.error('Upload error:', e);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
