import * as vscode from 'vscode';
import * as fs from 'fs';

export interface UploadedFile {
  name: string;
  path: string;
  content: string;
  mimeType: string;
  isImage: boolean;
}

export async function uploadDesign(): Promise<UploadedFile[] | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Upload to Ignis Claw',
    filters: {
      'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
      'Code': ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'json', 'xml', 'yaml', 'yml', 'md'],
      'All Files': ['*'],
    },
  });

  if (!uris || uris.length === 0) return undefined;

  const files: UploadedFile[] = [];

  for (const uri of uris) {
    try {
      const stat = fs.statSync(uri.fsPath);
      if (stat.size > 10 * 1024 * 1024) {
        vscode.window.showWarningMessage(`Skipped ${uri.fsPath} – file too large (>10MB)`);
        continue;
      }

      const bytes = fs.readFileSync(uri.fsPath);
      const ext = uri.fsPath.split('.').pop()?.toLowerCase() || '';
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

      files.push({
        name: uri.fsPath.split('\\').pop() || uri.fsPath.split('/').pop() || 'unknown',
        path: uri.fsPath,
        content: bytes.toString('base64'),
        mimeType: imageExts.includes(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'text/plain',
        isImage: imageExts.includes(ext),
      });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to read ${uri.fsPath}: ${err}`);
    }
  }

  return files.length > 0 ? files : undefined;
}

export function buildFileContextMessage(files: UploadedFile[]): string {
  const parts: string[] = [];

  for (const file of files) {
    if (file.isImage) {
      parts.push(`[Uploaded UI design: ${file.name} (image)]`);
    } else {
      parts.push(`[Uploaded file: ${file.name}]\n\`\`\`\n${Buffer.from(file.content, 'base64').toString('utf-8')}\n\`\`\``);
    }
  }

  return parts.join('\n\n');
}
