import * as vscode from 'vscode';
import { ChatPanel } from './chatPanel';
import { uploadDesign } from './fileHandler';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('ignis-claw.start', () => {
      ChatPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ignis-claw.uploadDesign', async () => {
      const files = await uploadDesign();
      if (!files) return;

      const panel = ChatPanel.createOrShow(context.extensionUri);
      panel.addFilesToContext(files);
    })
  );
}

export function deactivate() {}
