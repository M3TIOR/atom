'use babel';

import { CompositeDisposable, Emitter } from 'atom';
import repositoryForPath from './helpers';

const MAX_BUFFER_LENGTH_TO_DIFF = 2 * 1024 * 1024;

export default class GitDiffView {
  constructor(editor) {
    this.subscriptions = new CompositeDisposable();
    this.emitter = new Emitter();
    this.editor = editor;
    this.editorElm = editor.getElement();
    this.diffs = [];
    this.repository = null;
    this.markers = [];

    // I know this looks janky but it works. Class methods are available
    // before the constructor is executed. It's a micro-opt above lambdas.
    this.subscribeToRepository = this.subscribeToRepository.bind(this);
    this.moveToNextDiff = this.moveToNextDiff.bind(this);
    this.moveToPreviousDiff = this.moveToPreviousDiff.bind(this);
    this.updateIconDecoration = this.updateIconDecoration.bind(this);
    this.destroy = this.destroy.bind(this);
    this.updateDiffs = this.updateDiffs.bind(this);

    this.subscribeToRepository();

    this.subscriptions.add(
      atom.project.onDidChangePaths(this.subscribeToRepository),
      this.editor.onDidStopChanging(this.updateDiffs),
      this.editor.onDidChangePath(this.updateDiffs),
      atom.commands.add(
        this.editorElm,
        'git-diff:move-to-next-diff',
        this.moveToNextDiff
      ),
      atom.commands.add(
        this.editorElm,
        'git-diff:move-to-previous-diff',
        this.moveToPreviousDiff
      ),
      atom.config.onDidChange(
        'git-diff.showIconsInEditorGutter',
        this.updateIconDecoration
      ),
      atom.config.onDidChange(
        'editor.showLineNumbers',
        this.updateIconDecoration
      ),
      this.editorElm.onDidAttach(this.updateIconDecoration),
      this.editor.onDidDestroy(this.destroy)
    );
  }

  destroy() {
    this.removeDecorations();
    this.subscriptions.dispose();
    this._repoSubs.dispose();
    this.emitter.emit('did-destroy');
    this.emitter.dispose();
  }

  updateIconDecoration() {
    const gutter = this.editorElm.querySelector('.gutter');
    if (gutter) {
      const lineNumbersAreVisible = atom.config.get('editor.showLineNumbers');
      const useIcons = atom.config.get('git-diff.showIconsInEditorGutter');

      if (lineNumbersAreVisible && useIcons)
        gutter.classList.add('git-diff-icon');
      else gutter.classList.remove('git-diff-icon');
    }
  }

  moveToNextDiff() {
    let nextDiffLineNumber = null;
    let firstDiffLineNumber = null;

    if (this.diffs.length > 0) {
      const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
      // Assuming they're in order; there's no reason I can think of
      // the dev would scramble a linear output buffer search algorithm.
      //
      // Can confirm:
      //   Atom Internals uses -> https://www.npmjs.com/package/git-utils
      //       -> src/repository.cc { Repository::GetLineDiffs @ 775:0 }
      //   git-utils uses -> https://github.com/libgit2/libgit2
      //       -> src/patch_generate.c { git_diff_blob_to_buffer @ 618:0 }
      //       -> src/patch_generate.c { diff_from_sources @ 526:0 }
      //
      // I was really hoping it'd just be an easy for loop to decipher, but
      // no, git_diff_blob_to_buffer calls a callback to populate an array
      // for every diff it finds. I didn't dig all the way down the trace
      // to 100% validate. But the surface level looks 90% OK.
      //
      // XXX: leaving this NOTE here in case it causes issues in the future.
      firstDiffLineNumber = this.diffs[0].newStart - 1;

      nextDiffLineNumber = this.diffs.find(
        (e) => e.newStart > cursorLineNumber
      );
    }

    // Wrap around to the first diff in the file
    const shouldWrap = atom.config.get('git-diff.wrapAroundOnMoveToDiff');

    if (shouldWrap && nextDiffLineNumber == null)
      nextDiffLineNumber = firstDiffLineNumber;

    this.moveToLineNumber(nextDiffLineNumber);
  }

  moveToPreviousDiff() {
    let previousDiffLineNumber = null;
    let lastDiffLineNumber = null;

    if (this.diffs.length > 0) {
      const cursorLineNumber = this.editor.getCursorBufferPosition().row + 1;
      lastDiffLineNumber = this.diffs[this.diffs.length - 1].newStart - 1;
      previousDiffLineNumber = this.diffs.find(
        (e) => e.newStart > cursorLineNumber
      );
    }

    const shouldWrap = atom.config.get('git-diff.wrapAroundOnMoveToDiff');

    // Wrap around to the last diff in the file
    if (shouldWrap && previousDiffLineNumber === -1)
      previousDiffLineNumber = lastDiffLineNumber;

    this.moveToLineNumber(previousDiffLineNumber);
  }

  moveToLineNumber(lineNumber) {
    if (lineNumber != null) {
      this.editor.setCursorBufferPosition([lineNumber, 0]);
      this.editor.moveToFirstCharacterOfLine();
    }
  }

  async subscribeToRepository() {
    if (this._repoSubs) this._repoSubs.dispose();
    this._repoSubs = new CompositeDisposable();

    this.repository = await repositoryForPath(this.editor.getPath());
    if (this.repository != null) {
      this._repoSubs.add(
        this.repository.onDidChangeStatuses(this.updateDiffs),
        this.repository.onDidChangeStatus((changedPath) => {
          if (changedPath === this.editor.getPath()) this.updateDiffs();
        })
      );
    }

    // TODO: Update screen after subscription.
    this.updateIconDecoration();
    this.updateDiffs();
  }

  updateDiffs() {
    if (this.editor.isDestroyed()) return;
    this.removeDecorations();

    const path = this.editor.getPath();
    const bufferLength = this.editor.getBuffer().getLength();
    if (this.repository && bufferLength < MAX_BUFFER_LENGTH_TO_DIFF) {
      this.diffs = this.repository.getLineDiffs(path, this.editor.getText());
      // XXX: returning undefined for some reason. This is undocumented
      //      behavior. Perhaps it's a bug? Could investigate l8r.
      this.diffs = this.diffs || []; // For now, type guard.

      for (const { newStart, oldLines, newLines } of this.diffs) {
        const startRow = newStart - 1;
        const endRow = newStart + newLines - 1;

        if (oldLines === 0 && newLines > 0) {
          this.markRange(startRow, endRow, 'git-line-added');
        } else if (newLines === 0 && oldLines > 0) {
          if (startRow < 0) {
            this.markRange(0, 0, 'git-previous-line-removed');
          } else {
            this.markRange(startRow, startRow, 'git-line-removed');
          }
        } else {
          this.markRange(startRow, endRow, 'git-line-modified');
        }
      }
    }
  }

  removeDecorations() {
    for (let marker of this.markers) marker.destroy();
    this.markers = [];
  }

  markRange(startRow, endRow, klass) {
    const marker = this.editor.markBufferRange(
      [
        [startRow, 0],
        [endRow, 0],
      ],
      {
        invalidate: 'never',
      }
    );
    this.editor.decorateMarker(marker, { type: 'line-number', class: klass });
    this.markers.push(marker);
  }
}
