'use babel';

import SelectListView from 'atom-select-list';
import repositoryForPath from './helpers';

export default class DiffListView {
  constructor() {
    this.selectListView = new SelectListView({
      emptyMessage: 'No diffs in file',
      items: [],
      filterKeyForItem: (diff) => diff.lineText,
      elementForItem: (diff) => {
        const li = document.createElement('li');
        li.classList.add('two-lines');

        const primaryLine = document.createElement('div');
        primaryLine.classList.add('primary-line');
        primaryLine.textContent = diff.lineText;
        li.appendChild(primaryLine);

        const secondaryLine = document.createElement('div');
        secondaryLine.classList.add('secondary-line');
        secondaryLine.textContent = `-${diff.oldStart},${diff.oldLines} +${diff.newStart},${diff.newLines}`;
        li.appendChild(secondaryLine);

        return li;
      },
      didConfirmSelection: (diff) => {
        this.cancel();

        // Lazy equivalence -> 0 == false; New start will never be negative.
        const bufferRow = diff.newStart || diff.newStart - 1;

        this.editor.setCursorBufferPosition([bufferRow, 0], {
          autoscroll: true,
        });
        this.editor.moveToFirstCharacterOfLine();
      },
      didCancelSelection: () => {
        this.cancel();
      },
    });

    this.selectListView.element.classList.add('diff-list-view');

    this.panel = atom.workspace.addModalPanel({
      item: this.selectListView,
      visible: false,
    });
  }

  attach() {
    this.previouslyFocusedElement = document.activeElement;
    this.selectListView.reset();
    this.panel.show();
    this.selectListView.focus();
  }

  cancel() {
    this.panel.hide();
    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus();
      this.previouslyFocusedElement = null;
    }
  }

  destroy() {
    this.cancel();
    this.panel.destroy();
    return this.selectListView.destroy();
  }

  async toggle() {
    const editor = atom.workspace.getActiveTextEditor();

    if (this.panel.isVisible()) {
      this.cancel();
    } else if (editor) {
      this.editor = editor;
      const editorPath = this.editor.getPath();
      const editorText = this.editor.getText();

      const repository = await repositoryForPath();

      if (repository) {
        const diffs = repository.getLineDiffs(editorPath, editorText);

        for (let diff of diffs) {
          // Lazy equivalence -> 0 == false; New start will never be negative.
          const bufferRow = diff.newStart || diff.newStart - 1;

          diff.lineText = this.editor.lineTextForBufferRow(bufferRow).trim();
        }

        await this.selectListView.update({ items: diffs });
      } else {
        await this.selectListView.update({ items: [] });
      }

      this.attach();
    }
  }
}
