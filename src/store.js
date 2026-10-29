/* Everything the app keeps, in localStorage.

   Three things: the map being worked on (so a closed tab loses nothing), the
   library of maps the DM has saved, and the grounds they have generated or
   uploaded. There is no account and no server: this is one person's tool, and
   the browser that opened it is where their maps live.

   Every read is wrapped, because storage can be absent (a private window),
   full, or hold something an older version wrote; a read that fails is an empty
   library, never a crash. A write that fails returns false so the caller can
   say so — the grounds especially, since each carries a texture as a data URL
   and a handful of them can fill the ~5MB a browser allows. */

const PREFIX = 'dndmap:';

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
