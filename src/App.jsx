import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BattleMap from './BattleMap.jsx';
import MapWindow from './MapWindow.jsx';
import {
  readMap, packMap, readMapLibrary, packMapLibrary, readSavedMap, readThemeLibrary, readCustomTheme
} from './battlemap.js';
import { load, save } from './store.js';

/* The whole app: one map, a library to keep them in, and a second window to
   project it from.

   THE MAP BEING WORKED ON IS NOT A LIBRARY ENTRY. It is the draft — what is on
   the canvas right now — and it is written to storage as it changes, so closing
   the tab loses nothing. The library holds what the DM chose to keep, by name;
   loading one puts it on the canvas, saving puts the canvas into one. Keeping
   the two apart is what lets Undo bring back a map you loaded over. */

const WRITE_DELAY_MS = 400;

export default function App() {
  const [draft, setDraft] = useState(() => readMap(load('draft')));
  // Which library entry the draft came from, or 'draft': names the undo history.
  const [draftKey, setDraftKey] = useState(() => load('draftKey', 'draft'));
  const [maps, setMaps] = useState(() => readMapLibrary(load('maps', [])));
  const [grounds, setGrounds] = useState(() => readThemeLibrary(load('grounds', [])));
  const [popped, setPopped] = useState(false);
  const [notice, setNotice] = useState('');

  /* The draft is written once it has been still for a moment, not on every
     square of a drag: packing a big map is the slowest thing the app does. */
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!save('draft', packMap(draft)) || !save('draftKey', draftKey)) {
        setNotice('The browser has no room left to keep this map. Export it, or delete a saved map or ground.');
      }
    }, WRITE_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [draft, draftKey]);

  const writeMaps = useCallback((next) => {
    setMaps(next);
    if (!save('maps', packMapLibrary(next))) {
      setNotice('The browser has no room left for that. Delete a saved map or ground, then try again.');
      return false;
    }
    setNotice('');
    return true;
  }, []);

  /* Saving writes the canvas into a library entry: over the one picked, or as a
     new one. Returns the entry, which is what the panel reports back. */
  const saveMap = useCallback(({ id, name, map }) => {
    const existing = id && maps.find((x) => x.id === id);
    const entry = readSavedMap({
      id: existing ? existing.id : undefined,
      name: (name || '').trim() || (existing && existing.name) || `Map ${maps.length + 1}`,
      map
    });
    const next = existing ? maps.map((x) => (x.id === entry.id ? entry : x)) : [...maps, entry];
    if (!writeMaps(next)) return null;
    setDraftKey(entry.id);
    return entry;
  }, [maps, writeMaps]);

  const loadMap = useCallback((entry) => {
    setDraft(readMap(entry.map));
    setDraftKey(entry.id);
  }, []);

  const deleteMap = useCallback((entry) => {
    writeMaps(maps.filter((x) => x.id !== entry.id));
    if (draftKey === entry.id) setDraftKey('draft');
  }, [maps, draftKey, writeMaps]);

  /* A generated or uploaded ground joins the picker beside the built-in ten.
     Resolves to the saved record, or null if it could not be kept. */
  const saveGround = useCallback(async (fields) => {
    const made = readCustomTheme(fields);
    if (!made) {
      setNotice('That ground has no usable floor image, so it was not saved.');
      return null;
    }
    const next = [...grounds, made];
    setGrounds(next);
    if (!save('grounds', next)) {
      setGrounds(grounds);
      setNotice('The browser has no room left for another ground. Delete a saved one first.');
      return null;
    }
    setNotice('');
    return made;
  }, [grounds]);

  const mapProps = useMemo(() => ({
    map: draft,
    onChange: setDraft,
    historyKey: draftKey,
    customThemes: grounds,
    onSaveTheme: saveGround,
    decks: maps,
    onSaveDeck: saveMap,
    onLoadDeck: loadMap,
    onDeleteDeck: deleteMap
  }), [draft, draftKey, grounds, saveGround, maps, saveMap, loadMap, deleteMap]);

  return (
    <div className="app">
      <div className="app__container">
        <header className="app__banner">
          <h1>Battle Map Builder<small>for 5e · weapons and spells project as overlays</small></h1>
          <button type="button" className="bm-btn" onClick={() => { setNotice(''); setPopped(true); }}
            disabled={popped}
            title="Open the map in its own window, for a projector or a second screen">
            {popped ? 'Projecting…' : 'Project in a window'}
          </button>
        </header>

        {notice ? <div className="bm-warn" role="alert">{notice}</div> : null}

        <main className="app__card">
          {popped ? (
            <p className="bm-hint app__popout">
              The map is running in a second window. Closing that window brings it back here.
            </p>
          ) : (
            <BattleMap {...mapProps} />
          )}
        </main>
      </div>

      {popped && (
        <MapWindow
          title="Battle map"
          onClose={(why) => {
            setPopped(false);
            if (why === 'blocked') setNotice('The browser blocked the pop-up. Allow pop-ups for this site, then try again.');
          }}
        >
          {(win) => <BattleMap {...mapProps} win={win} />}
        </MapWindow>
      )}
    </div>
  );
}
