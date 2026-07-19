export const config = { path: "/api/nowplaying" };

const API = "https://api.music.yandex.net";
const TTL = 20 * 1000;
let cache = { at: 0, data: null };
const ERROR_TTL = 2 * 60 * 1000;
let errorUntil = 0;

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");
  const now = Date.now();

  if (!debug && cache.data && now - cache.at < TTL) {
    return json(cache.data, 200, "hit");
  }
  if (!debug && now < errorUntil) {
    return json(cache.data || { playing: false }, 200, "cooldown");
  }

  const token = process.env.YANDEX_MUSIC_TOKEN;
  if (!token) return json({ error: "token not set" }, 500);

  const headers = {
    "Authorization": "OAuth " + token,
    "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
    "User-Agent": "Yandex-Music-API",
  };

  const log = [];

  try {
    // РїСЂРѕРІРµСЂРєР° С‚РѕРєРµРЅР°
    const acc = await get(API + "/account/status", headers);
    log.push({ step: "account", uid: acc?.result?.account?.uid, name: acc?.result?.account?.displayName });

    // РѕС‡РµСЂРµРґРё
    const qRes = await get(API + "/queues", headers);
    const queues = qRes?.result?.queues;
    log.push({ step: "queues", count: queues?.length ?? 0, raw: debug ? qRes : undefined });

    if (!queues?.length) {
      return debug ? json({ log }, 200, "debug") : store({ playing: false });
    }

    const latest = queues[0];
    const isNow = Date.now() - new Date(latest.modified).getTime() < 5 * 60 * 1000;

    const queue = (await get(API + "/queues/" + latest.id, headers))?.result;
    const current = queue?.tracks?.[queue.currentIndex];
    log.push({ step: "queue", index: queue?.currentIndex, tracks: queue?.tracks?.length, current });

    if (!current) {
      return debug ? json({ log }, 200, "debug") : store({ playing: false });
    }

    const id = String(current.trackId).split(":")[0];
    const track = (await get(API + "/tracks/" + id, headers))?.result?.[0];
    log.push({ step: "track", title: track?.title });

    if (!track) {
      return debug ? json({ log }, 200, "debug") : store({ playing: false });
    }

    const data = {
      playing: isNow,
      title: track.title,
      artist: (track.artists || []).map(a => a.name).join(", "),
    };
    if (debug) return json({ log, data }, 200, "debug");
    return store(data);
  } catch (e) {
    if (debug) return json({ log, error: String(e) }, 200, "debug");
    errorUntil = Date.now() + ERROR_TTL;
    return json(cache.data || { playing: false }, 200, "stale");
  }
};

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("yandex " + res.status + " on " + url);
  return res.json();
}

function store(data) {
  cache = { at: Date.now(), data };
  errorUntil = 0;
  return json(data, 200, "miss");
}

function json(body, status = 200, cacheState = "") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Cache": cacheState,
    },
  });
}
