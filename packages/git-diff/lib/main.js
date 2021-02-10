'use babel';

import { CompositeDisposable } from 'atom';
import GitDiffView from './git-diff-view';
import DiffListView from './diff-list-view';

let diffListView = null;

export default {
  activate(state) {
    this.subscriptions = new CompositeDisposable();

    this.subscriptions.add(
      atom.workspace.observeTextEditors((editor) => {
        const editorElm = editor.getElement();
        const diffView = new GitDiffView(editor);

        this.subscriptions.add(
          atom.commands.add(editorElm, 'git-diff:toggle-diff-list', () => {
            if (diffListView == null) diffListView = new DiffListView();
            diffListView.toggle();
          }),
          // Temporary fix; nested subs will be destroyed with the parent.
          diffView.subscriptions
        );
      })
    );
  },

  deactivate() {
    this.subscriptions.dispose();
  },
};
