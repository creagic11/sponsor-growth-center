/* Persistence for the edit log, in this browser (localStorage).
 * The original dataset files are never modified; edits replay on top of them, so "Reset" restores the original exactly.
 */
(function () {
  'use strict';
  const LS_KEY = (ws) => 'gc_edits_v1_' + ws;
  const listeners = new Set();
  const state = { mode: 'starting', edits: {}, note: '' };

  function lsRead(ws) { try { return JSON.parse(localStorage.getItem(LS_KEY(ws)) || '[]'); } catch (e) { return []; } }
  function lsWrite(ws, arr) { try { localStorage.setItem(LS_KEY(ws), JSON.stringify(arr)); return true; } catch (e) { return false; } }
  const emit = (ws) => listeners.forEach((f) => f(ws));

  async function init(workspaceIds) {
    for (const ws of workspaceIds) state.edits[ws] = lsRead(ws);
    let ok = true; try { localStorage.setItem('gc_probe', '1'); localStorage.removeItem('gc_probe'); } catch (e) { ok = false; }
    state.mode = ok ? 'browser' : 'memory';
    state.note = ok ? 'Changes are saved in this browser.' : 'This browser blocks storage, so changes last only until you close the page.';
    emit(null);
    return state.mode;
  }

  async function add(ws, edit) {
    const clean = JSON.parse(JSON.stringify(edit));
    state.edits[ws] = [...(state.edits[ws] || []), clean];
    lsWrite(ws, state.edits[ws]);
    emit(ws);
    return { ok: true, mode: state.mode };
  }

  async function reset(ws) {
    state.edits[ws] = [];
    lsWrite(ws, []);
    emit(ws);
    return { ok: true };
  }

  // Undo: remove one edit from the log (the base data is untouched, so this is exact).
  async function remove(ws, id) {
    state.edits[ws] = (state.edits[ws] || []).filter((e) => e.id !== id);
    lsWrite(ws, state.edits[ws]);
    emit(ws);
    return { ok: true };
  }

  function exportEdits(ws) { return JSON.stringify(state.edits[ws] || [], null, 2); }
  function importEdits(ws, text) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) throw new Error('Expected a JSON array of edits');
    return Promise.all(arr.filter((e) => e && e.id && e.type).map((e) => add(ws, e)));
  }

  window.GCStore = { init, add, reset, remove, get: (ws) => state.edits[ws] || [], mode: () => state.mode, note: () => state.note, on: (f) => listeners.add(f), exportEdits, importEdits };
})();
