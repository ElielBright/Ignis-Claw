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
exports.toolDefinitions = void 0;
exports.executeTool = executeTool;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.toolDefinitions = [
    {
        name: 'read_file',
        description: 'Read the contents of a file from the workspace. Use this when you need to examine code, config, or text files.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Relative path from workspace root or absolute path to file',
                },
            },
            required: ['file_path'],
        },
    },
    {
        name: 'write_file',
        description: 'Write content to a file in the workspace. Creates the file if it doesn\'t exist. Use this when you need to create or modify files.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Relative path from workspace root or absolute path to file',
                },
                content: {
                    type: 'string',
                    description: 'The full content to write to the file',
                },
            },
            required: ['file_path', 'content'],
        },
    },
    {
        name: 'edit_file',
        description: 'Make a targeted edit to an existing file. Replaces the first occurrence of old_string with new_string. Use this for surgical changes instead of rewriting the whole file.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Relative path from workspace root or absolute path to file',
                },
                old_string: {
                    type: 'string',
                    description: 'The exact text to replace (must be unique in the file)',
                },
                new_string: {
                    type: 'string',
                    description: 'The new text to insert in place of old_string',
                },
            },
            required: ['file_path', 'old_string', 'new_string'],
        },
    },
    {
        name: 'create_file',
        description: 'Create a new file in the workspace. Fails if the file already exists.',
        input_schema: {
            type: 'object',
            properties: {
                file_path: {
                    type: 'string',
                    description: 'Relative path from workspace root or absolute path for the new file',
                },
                content: {
                    type: 'string',
                    description: 'The content to write to the new file',
                },
            },
            required: ['file_path', 'content'],
        },
    },
    {
        name: 'list_files',
        description: 'List files and directories matching a glob pattern. Use this to explore the project structure.',
        input_schema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Glob pattern to match (e.g. "**/*.ts", "src/**/*.rs", "**/*.{json,toml}")',
                },
                path: {
                    type: 'string',
                    description: 'Optional base path to search from (relative to workspace root)',
                },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'grep_search',
        description: 'Search for a regex pattern in files across the workspace. Use this to find where functions are defined, patterns are used, etc.',
        input_schema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Regex pattern to search for',
                },
                include: {
                    type: 'string',
                    description: 'Optional file glob pattern to filter (e.g. "*.ts", "*.rs")',
                },
            },
            required: ['pattern'],
        },
    },
    {
        name: 'run_command',
        description: 'Run a shell command in the workspace directory. Use this to install dependencies, run tests, build projects, etc. The user will be asked to approve the command before execution.',
        input_schema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'The shell command to execute',
                },
                description: {
                    type: 'string',
                    description: 'A brief description of what this command does',
                },
            },
            required: ['command', 'description'],
        },
    },
];
function getWorkspaceRoot() {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath;
}
function resolvePath(filePath) {
    const root = getWorkspaceRoot();
    if (path.isAbsolute(filePath))
        return filePath;
    if (root)
        return path.join(root, filePath);
    return path.resolve(filePath);
}
async function executeTool(toolCall) {
    const { name, arguments: argsStr } = toolCall.function;
    let args;
    try {
        args = JSON.parse(argsStr);
    }
    catch {
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: `Error: Invalid JSON arguments: ${argsStr}`,
            isError: true,
        };
    }
    try {
        let result;
        switch (name) {
            case 'read_file':
                result = await toolReadFile(args.file_path);
                break;
            case 'write_file':
                result = await toolWriteFile(args.file_path, args.content);
                break;
            case 'edit_file':
                result = await toolEditFile(args.file_path, args.old_string, args.new_string);
                break;
            case 'create_file':
                result = await toolCreateFile(args.file_path, args.content);
                break;
            case 'list_files':
                result = await toolListFiles(args.pattern, args.path);
                break;
            case 'grep_search':
                result = await toolGrepSearch(args.pattern, args.include);
                break;
            case 'run_command':
                result = await toolRunCommand(args.command, args.description);
                break;
            default:
                return {
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    content: `Unknown tool: ${name}`,
                    isError: true,
                };
        }
        return { tool_call_id: toolCall.id, role: 'tool', content: result };
    }
    catch (err) {
        return {
            tool_call_id: toolCall.id,
            role: 'tool',
            content: `Error executing ${name}: ${err.message}`,
            isError: true,
        };
    }
}
async function toolReadFile(filePath) {
    const resolved = resolvePath(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${filePath} (resolved: ${resolved})`);
    }
    const stat = fs.statSync(resolved);
    if (stat.size > 1024 * 1024) {
        throw new Error(`File too large: ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)}MB). Max 1MB.`);
    }
    const content = fs.readFileSync(resolved, 'utf-8');
    return content;
}
async function toolWriteFile(filePath, content) {
    const resolved = resolvePath(filePath);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    const doc = await vscode.workspace.openTextDocument(resolved);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
    vscode.window.showInformationMessage(`Wrote ${filePath}`);
    return `Successfully wrote ${filePath} (${content.length} bytes)`;
}
async function toolEditFile(filePath, oldString, newString) {
    const resolved = resolvePath(filePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`File not found: ${filePath}`);
    }
    let content = fs.readFileSync(resolved, 'utf-8');
    const idx = content.indexOf(oldString);
    if (idx === -1) {
        throw new Error(`Could not find old_string in ${filePath}. Make sure the text to replace exists and is exact.`);
    }
    content = content.replace(oldString, newString);
    fs.writeFileSync(resolved, content, 'utf-8');
    const doc = await vscode.workspace.openTextDocument(resolved);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
    vscode.window.showInformationMessage(`Edited ${filePath}`);
    return `Successfully applied edit to ${filePath}`;
}
async function toolCreateFile(filePath, content) {
    const resolved = resolvePath(filePath);
    if (fs.existsSync(resolved)) {
        throw new Error(`File already exists: ${filePath}`);
    }
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content, 'utf-8');
    const doc = await vscode.workspace.openTextDocument(resolved);
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
    vscode.window.showInformationMessage(`Created ${filePath}`);
    return `Successfully created ${filePath} (${content.length} bytes)`;
}
async function toolListFiles(pattern, searchPath) {
    const root = searchPath ? resolvePath(searchPath) : getWorkspaceRoot();
    if (!root)
        throw new Error('No workspace folder open');
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, pattern), '**/node_modules/**');
    if (files.length === 0) {
        return `No files matching "${pattern}"`;
    }
    return files
        .map(uri => uri.fsPath)
        .map(fp => {
        const rel = path.relative(root, fp);
        return rel;
    })
        .sort()
        .join('\n');
}
async function toolGrepSearch(pattern, include) {
    const root = getWorkspaceRoot();
    if (!root)
        throw new Error('No workspace folder open');
    const includeGlob = include || '**/*';
    const files = await vscode.workspace.findFiles(includeGlob, '**/node_modules/**', 50);
    const results = [];
    const regex = new RegExp(pattern, 'i');
    for (const file of files) {
        try {
            const content = fs.readFileSync(file.fsPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    const rel = path.relative(root, file.fsPath);
                    results.push(`${rel}:${i + 1}: ${lines[i].trim()}`);
                }
            }
        }
        catch { }
    }
    if (results.length === 0)
        return `No matches for "${pattern}"`;
    return results.slice(0, 100).join('\n');
}
async function toolRunCommand(command, description) {
    const root = getWorkspaceRoot();
    if (!root)
        throw new Error('No workspace folder open');
    const approved = await vscode.window.showInformationMessage(`Allow Ignis Claw to run: ${description}?\n\n\`${command}\``, { modal: true }, 'Allow', 'Deny');
    if (approved !== 'Allow') {
        vscode.window.showWarningMessage('Command execution denied by user');
        return 'Command execution denied by user';
    }
    return new Promise((resolve) => {
        const terminal = vscode.window.createTerminal({
            name: 'Ignis Claw',
            cwd: root,
            message: `${description}\n${command}`,
        });
        terminal.show();
        terminal.sendText(command);
        vscode.window.showInformationMessage(`Running: ${description}`);
        const exec = require('child_process').exec;
        exec(command, { cwd: root }, (err, stdout, stderr) => {
            if (err) {
                resolve(`Exit code: ${err.code}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
            }
            else {
                resolve(`Exit code: 0\nstdout:\n${stdout}${stderr ? `\nstderr:\n${stderr}` : ''}`);
            }
        });
        const disposable = vscode.window.onDidCloseTerminal((t) => {
            if (t.name === 'Ignis Claw')
                disposable.dispose();
        });
    });
}
//# sourceMappingURL=tools.js.map