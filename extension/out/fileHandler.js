"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadDesign = uploadDesign;
exports.buildFileContextMessage = buildFileContextMessage;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
async function uploadDesign() {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Upload to Ignis Claw',
        filters: {
            'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
            'Code': ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'json', 'xml', 'yaml', 'yml', 'md'],
            'All Files': ['*'],
        },
    });
    if (!uris || uris.length === 0)
        return undefined;
    const files = [];
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
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to read ${uri.fsPath}: ${err}`);
        }
    }
    return files.length > 0 ? files : undefined;
}
function buildFileContextMessage(files) {
    const parts = [];
    for (const file of files) {
        if (file.isImage) {
            parts.push(`[Uploaded UI design: ${file.name} (image)]`);
        }
        else {
            parts.push(`[Uploaded file: ${file.name}]\n\`\`\`\n${Buffer.from(file.content, 'base64').toString('utf-8')}\n\`\`\``);
        }
    }
    return parts.join('\n\n');
}
//# sourceMappingURL=fileHandler.js.map