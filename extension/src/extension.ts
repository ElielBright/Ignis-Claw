import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { uploadDesign } from './fileHandler';

let extensionContext: vscode.ExtensionContext;

export function getContext(): vscode.ExtensionContext {
  return extensionContext;
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('ignis-claw.start', () => {
      ChatPanel.createOrShow(context.extensionUri, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ignis-claw.uploadDesign', async () => {
      const files = await uploadDesign();
      if (!files) return;

      const panel = ChatPanel.createOrShow(context.extensionUri, context);
      panel.addFilesToContext(files);
    })
  );
}

export function deactivate() {}
