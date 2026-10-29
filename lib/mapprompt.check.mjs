// Self-check for the map-texture prompt. Run: node lib/mapprompt.check.mjs
import assert from 'node:assert/strict';
import {
  ENVIRONMENTS, CONDITIONS, environmentById, conditionById, buildTexturePrompt
, MAX_DESCRIBE, buildSpritesPrompt, SHEET_SLOT_ROLES
} from './mapprompt.js';
// The app's side of the same contract. Imported so the two orders are checked
// against each other rather than kept in step by hand.
import { SPRITE_ROLES, SHEET_CELLS } from '../src/spritesheet.js';

/* ---- the vocabulary is complete ---- */

{
  assert.ok(ENVIRONMENTS.length >= 10, 'a GM wants more than a handful of grounds');
  const ids = ENVIRONMENTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate environment id');
  for (const e of ENVIRONMENTS) {
    assert.ok(e.name, e.id + ': no display name');
    // A name alone means nothing to an image model. Every environment has to
    // carry the phrases, the same way every origin option does next door.
    assert.ok(e.surface && e.surface.length > 20, e.id + ': surface phrase too thin');
    assert.ok(e.detail && e.detail.length > 20, e.id + ': detail phrase too thin');
    assert.equal(/\bgrid\b|\btext\b|\blogo\b/i.test(e.surface + e.detail), false,
      e.id + ': an environment must not reintroduce what the fixed part forbids');
  }

  assert.ok(CONDITIONS.length >= 5);
  const cids = CONDITIONS.map((c) => c.id);
  assert.equal(new Set(cids).size, cids.length, 'duplicate condition id');
  // 'none' exists and is deliberately empty: it is the default, and it must
  // add nothing rather than adding a word that means nothing.
  const none = conditionById('none');
  assert.ok(none, "there must be a 'no condition' option");
  assert.equal(none.phrase, '');
  for (const c of CONDITIONS) {
    assert.ok(c.name, c.id + ': no display name');
    if (c.id !== 'none') assert.ok(c.phrase.length > 10, c.id + ': phrase too thin');
  }

  assert.equal(environmentById('nonsense'), null);
  assert.equal(environmentById(null), null);
  assert.equal(conditionById('nonsense'), null);
}

/* ---- the fixed part is always there ---- */

{
  // These are the clauses that make the image usable as a FLOOR rather than
  // as a picture. If a refactor drops one, the next generated texture is
  // subtly wrong in a way that only shows on a projector.
  const must = [
    'photorealistic',          // the medium, and it LEADS — see the note in mapprompt.js
    'shot straight down from directly overhead',
    'seamless tiling',
    'no grid lines',
    'No text',
    'no perspective',
    'flat even light',
    'fantasy dungeon-crawl tabletop'
  ];
  for (const env of ENVIRONMENTS) {
    for (const cond of CONDITIONS) {
      const p = buildTexturePrompt({ environment: env.id, condition: cond.id });
      for (const clause of must) {
        assert.ok(p.includes(clause), `${env.id}/${cond.id}: lost "${clause}"`);
      }
      assert.ok(p.includes(env.surface), `${env.id}: the surface did not reach the prompt`);
      assert.ok(p.length < 1400, `${env.id}/${cond.id}: ${p.length} chars is too long to steer`);
      assert.ok(p.endsWith('.'));
      assert.equal(p.includes(', ,'), false, 'an empty clause left a hole');
    }
  }
}

/* ---- the medium leads ---- */

{
  // An earlier version led with "top-down orthographic floor texture" and left
  // "photorealistic" to the very end, after a run of negations — and what
  // came back was illustration rather than photography. The portrait prompt
  // next door leads with the medium, and this has to as well.
  const p = buildTexturePrompt({ describe: 'a market square' });
  assert.ok(/^A photorealistic/.test(p), 'the prompt must open with the medium');
  assert.ok(p.indexOf('photorealistic') < p.indexOf('market square'),
    'the medium comes before the subject');
  assert.ok(p.indexOf('photorealistic') < 80, 'and it is not buried');
  // And it says what it is NOT, because "game art" is the default register
  // for a fantasy prompt and it is the wrong one here.
  assert.ok(p.includes('not illustrated') && p.includes('not rendered as game art'));
  // The prohibitions are their own sentence rather than a mid-sentence aside.
  assert.ok(p.includes('. No text'), 'the prohibitions should start a sentence');
}

/* ---- a described ground ---- */

{
  // The DM's words lead, and the cover goes in behind them.
  const p = buildTexturePrompt({
    describe: 'a flooded crypt floor, black water over cracked flagstone',
    cover: 'toppled pillars, scattered bones'
  });
  assert.ok(p.includes('flooded crypt floor'));
  assert.ok(p.includes('scattered across it: toppled pillars'));

  // A description beats the list entries: it is the specific thing asked for.
  const both = buildTexturePrompt({ describe: 'a frozen parade ground', environment: 'forest' });
  assert.ok(both.includes('frozen parade ground'));
  assert.equal(both.includes('woodland floor'), false, 'the list entry should not fight the description');

  // A condition still composes with a description, because it is weather
  // rather than a subject.
  const withCond = buildTexturePrompt({ describe: 'a market square', condition: 'battle' });
  assert.ok(withCond.includes('market square') && withCond.includes('trampled'));

  // Capped, so the fixed clauses still steer the result rather than being
  // drowned by a wall of text, and newlines pasted from elsewhere do not
  // break the prompt into pieces.
  const long = buildTexturePrompt({ describe: 'x'.repeat(5000) });
  assert.ok(long.length < 1400 + MAX_DESCRIBE, 'the description is not capped');
  assert.ok(buildTexturePrompt({ describe: 'a\n\nb\tc' }).includes('a b c'));
  assert.ok(buildTexturePrompt({ describe: '   ' }).includes(ENVIRONMENTS[0].surface),
    'blank falls back rather than billing for an empty request');

  // Unknown fields are still ignored — only describe, cover, environment
  // and condition are read.
  const ignored = buildTexturePrompt({ describe: 'a deck', style: 'oil painting', size: '512x1024' });
  assert.equal(/oil painting|512x1024/i.test(ignored), false);

  // THE CLAUSES SURVIVE A DESCRIPTION. This is what free text gives up and
  // what it does not: the GM says what is on the ground, and the shot, the
  // lighting and the prohibitions are still ours.
  for (const clause of ['photorealistic', 'seamless tiling', 'no grid lines', 'no perspective']) {
    assert.ok(p.includes(clause), 'a description displaced "' + clause + '"');
  }

  // An unknown environment falls back to a real one rather than producing a
  // promptless request that bills for nothing.
  const fallback = buildTexturePrompt({ environment: 'nonsense' });
  assert.ok(fallback.includes(ENVIRONMENTS[0].surface));
  assert.ok(buildTexturePrompt(null).length > 100);
  assert.ok(buildTexturePrompt(undefined).includes('seamless tiling'));
  assert.ok(buildTexturePrompt('a string').includes('seamless tiling'));

  // An unknown condition drops out silently; it does not become a word.
  const noCond = buildTexturePrompt({ environment: 'ice', condition: 'nonsense' });
  assert.equal(noCond, buildTexturePrompt({ environment: 'ice', condition: 'none' }));
}

/* ---- the conditions actually change the prompt ---- */

{
  const dry = buildTexturePrompt({ environment: 'ruin', condition: 'none' });
  const wet = buildTexturePrompt({ environment: 'ruin', condition: 'flooded' });
  assert.notEqual(dry, wet, 'a condition that changes nothing is a dead control');
  assert.ok(wet.includes('standing water'));
  // And they compose with every environment rather than only the obvious one.
  assert.ok(buildTexturePrompt({ environment: 'forge', condition: 'overgrown' })
    .includes('roots and creeper'));
}

/* ---- the prop sheet ----

   THE ONE THAT MATTERS is the first: the prompt asks for sixteen things in a
   fixed order and the app cuts the sheet up by position, so if these two
   lists ever drift the app draws the fire where the pillar should be. Nothing
   else would catch it — the image comes back, the cells are full, and only a
   human looking at a deck would notice the pillar is on fire. */
{
  assert.deepEqual(SHEET_SLOT_ROLES, SPRITE_ROLES,
    'the prompt asks for the cells in the order the app cuts them out');
  assert.equal(SHEET_SLOT_ROLES.length, SHEET_CELLS, 'and asks for all of them');

  const p = buildSpritesPrompt({ describe: 'a flooded cargo hold, rusted plate' });

  // The grid, which is what makes it cuttable at all.
  assert.ok(/4x4 grid of 16 separate objects/.test(p), 'it asks for the grid');
  assert.ok(/centred in its own cell/.test(p), 'and for each object to sit in its cell');
  assert.ok(/no cell borders, no grid lines/.test(p),
    'and for no drawn cell edges, which would be cut into every token');

  // The black background, which is what makes it keyable.
  assert.ok(/pitch-black background, pure #000000/.test(p), 'the keyable background');
  assert.ok(/no shadow cast onto the background/.test(p),
    'and no shadow on it, which would key into a grey smear');

  // The negatives the GM asked for by name. Every one of these is a thing an
  // image model adds unasked to anything called a token.
  for (const no of ['no circular token frame', 'no coin border', 'no medallion ring',
    'no plastic miniature base', 'no disc base']) {
    assert.ok(p.toLowerCase().includes(no), `it refuses: ${no}`);
  }
  assert.ok(/100% directly overhead/.test(p), 'and insists on straight down');
  assert.ok(/no isometric angle/i.test(p), 'and refuses isometric');

  // The ground's own description reaches the props, which is the whole point
  // of generating them from it rather than from a fixed list.
  assert.ok(p.includes('a flooded cargo hold, rusted plate'),
    'the props are built of the ground they stand on');

  // Every cell is described, and the door that must show the floor through it
  // says so: an "open" door drawn as a solid leaf is a wall.
  assert.ok(/the opening itself empty black so the floor shows through/.test(p),
    'the open doorway is asked for as an opening');

  // It behaves like the floor prompt on junk input rather than throwing.
  for (const junk of [null, undefined, 42, 'text', { describe: null }, { environment: 'nope' }]) {
    const out = buildSpritesPrompt(junk);
    assert.ok(typeof out === 'string' && out.length > 400, `junk input still builds: ${JSON.stringify(junk)}`);
    assert.ok(/4x4 grid/.test(out), 'and still asks for the grid');
  }
  // An environment with no description still places the props.
  assert.ok(buildSpritesPrompt({ environment: 'tundra' }).includes('frozen tundra'),
    'the environment list fills in behind an empty description');
  assert.ok(buildSpritesPrompt({ environment: 'ruin', condition: 'flooded' })
    .includes('standing water'), 'and conditions carry through to the props');
  // The description is capped the same way the floor's is: this prompt is
  // built from GM text and goes to the owner's paid key.
  const long = buildSpritesPrompt({ describe: 'x'.repeat(5000) });
  assert.ok(!long.includes('x'.repeat(MAX_DESCRIBE + 1)), 'the description is capped');
}

console.log('mapprompt.js OK (%d environments, %d conditions, %d combinations, %d prop cells)',
  ENVIRONMENTS.length, CONDITIONS.length, ENVIRONMENTS.length * CONDITIONS.length,
  SHEET_SLOT_ROLES.length);
