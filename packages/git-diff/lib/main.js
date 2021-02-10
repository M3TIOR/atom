'use babel';

import { CompositeDisposable } from 'atom';
import GitDiffView from './git-diff-view';
import DiffListView from './diff-list-view';

let diffListUI = null;
let diffViews = null;

export default {
  activate(state) {
    this.subscriptions = new CompositeDisposable();

    diffViews = new Set();

    this.subscriptions.add(
      atom.workspace.observeTextEditors((editor) => {
        const editorElm = editor.getElement();
        const diffView = new GitDiffView(editor);

        diffViews.add(diffView);

        this.subscriptions.add(
          atom.commands.add(editorElm, 'git-diff:toggle-diff-list', () => {
            if (diffListUI == null) diffListUI = new DiffListView();
            diffListUI.toggle();
          }),
          diffView.emitter.on('did-destroy', () => diffViews.delete(diffView))
        );
      })
    );
  },

  deactivate() {
    diffListUI = null;

    for (const v of diffViews) v.destroy();
    diffViews = null;

    this.subscriptions.dispose();
  },
};
