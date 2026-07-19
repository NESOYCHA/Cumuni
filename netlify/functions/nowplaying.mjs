export const config = { path: "/api/nowplaying" };

const API = "https://api.music.yandex.net";
const TTL = 20 * 1000;
let cache = { at: 0, data: null };
const ERROR_TTL = 2 * 60 * 1000;
let errorUntil = 0;

export default async () => {
  const now = Date.now();

  if (cache.data && now - cache.at < TTL) {
    return json(cache.data, 200, "hit");
  }
  if (now < errorUntil) {
    return json(cache.data || { playing: false }, 200, "cooldown");
  }

  const token = process.env.YANDEX_MUSIC_TOKEN;
  if (!token) return json({ error: "token not set" }, 500);

  const headers = {
    "Authorization": "OAuth " + token,
    "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
  };

  try {
    const queues = (await get(API + "/queues", headers))?.result?.queues;
    if (!queues?.length) return store({ playing: false });

    const latest = queues[0];
    const isNow = Date.now() - new Date(latest.modified).getTime() < 5 * 60 * 1000;

    const queue = (await get(API + "/queues/" + latest.id, headers))?.result;
    const current = queue?.tracks?.[queue.currentIndex];
    if (!current) return store({ playing: false });

    const track = (await get(API + "/tracks/" + current.trackId, headers))?.result?.[0];
    if (!track) return store({ playing: false });

    return store({
      playing: isNow,
      title: track.title,
      artist: (track.artists || []).map(a => a.name).join(", "),
    });
  } catch (e) {
    errorUntil = Date.now() + ERROR_TTL;
    return json(cache.data || { playing: false }, 200, "stale");
  }
};

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("yandex " + res.status);
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
      "Cache-Control": "public, max-age=20",
      "X-Cache": cacheState,
    },
  });
}
