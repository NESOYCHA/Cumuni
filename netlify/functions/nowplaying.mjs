export const config = { path: "/api/nowplaying" };

const API = "https://api.music.yandex.net";
const TTL = 20 * 1000;
let cache = { at: 0, data: null };
const ERROR_TTL = 2 * 60 * 1000;
let errorUntil = 0;

// РЇРЅРґРµРєСЃ С‚СЂРµР±СѓРµС‚ Р·Р°РіРѕР»РѕРІРѕРє СЃ РѕРїРёСЃР°РЅРёРµРј СѓСЃС‚СЂРѕР№СЃС‚РІР°, РёРЅР°С‡Рµ /queues РѕС‚РґР°С‘С‚ 400
const DEVICE = "os=Android; os_version=13; manufacturer=Xiaomi; model=Redmi; clid=; device_id=random_device_id; uuid=random_uuid";

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");
  const now = Date.now();

  if (!debug && cache.data && now - cache.at < TTL) return json(cache.data, 200, "hit");
  if (!debug && now < errorUntil) return json(cache.data || { playing: false }, 200, "cooldown");

  const token = process.env.YANDEX_MUSIC_TOKEN;
  if (!token) return json({ error: "token not set" }, 500);

  const headers = {
    "Authorization": "OAuth " + token,
    "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
    "X-Yandex-Music-Device": DEVICE,
    "User-Agent": "Yandex-Music-API",
  };

  const log = [];
  let uid = null;

  try {
    const acc = await get(API + "/account/status", headers);
    uid = acc?.result?.account?.uid;
    log.push({ step: "account", ok: !!uid });
  } catch (e) {
    log.push({ step: "account", error: String(e) });
  }

  // в”Ђв”Ђ РЎРїРѕСЃРѕР± 1: РѕС‡РµСЂРµРґРё РІРѕСЃРїСЂРѕРёР·РІРµРґРµРЅРёСЏ в”Ђв”Ђ
  try {
    const qRes = await get(API + "/queues", headers);
    const queues = qRes?.result?.queues;
    log.push({ step: "queues", count: queues?.length ?? 0 });

    if (queues?.length) {
      const latest = queues[0];
      const isNow = Date.now() - new Date(latest.modified).getTime() < 5 * 60 * 1000;
      const queue = (await get(API + "/queues/" + latest.id, headers))?.result;
      const current = queue?.tracks?.[queue.currentIndex ?? 0];
      log.push({ step: "queue", tracks: queue?.tracks?.length, current });

      if (current) {
        const id = String(current.trackId).split(":")[0];
        const track = (await get(API + "/tracks/" + id, headers))?.result?.[0];
        if (track) return finish({
          playing: isNow,
          title: track.title,
          artist: names(track.artists),
        }, "queues");
      }
    }
  } catch (e) {
    log.push({ step: "queues", error: String(e) });
  }

  // в”Ђв”Ђ РЎРїРѕСЃРѕР± 2: РЅРµРґР°РІРЅРѕ РїСЂРѕСЃР»СѓС€Р°РЅРЅРѕРµ СЃ РіР»Р°РІРЅРѕР№ в”Ђв”Ђ
  try {
    const land = await get(API + "/landing3?blocks=play_contexts", headers);
    const entities = land?.result?.blocks?.[0]?.entities;
    log.push({ step: "landing", count: entities?.length ?? 0 });

    // РІ РѕС‚Р»Р°РґРєРµ РїРѕРєР°Р·С‹РІР°РµРј СЃС‹СЂСѓСЋ СЃС‚СЂСѓРєС‚СѓСЂСѓ РїРµСЂРІРѕР№ Р·Р°РїРёСЃРё, С‡С‚РѕР±С‹ РїРѕРЅСЏС‚СЊ С„РѕСЂРјР°С‚
    if (debug && entities?.length) {
      return json({ log, sample: entities[0] }, 200, "debug");
    }

    const track = findTrack(entities?.[0]);
    if (track?.title) {
      return finish({ playing: false, title: track.title, artist: names(track.artists) }, "landing");
    }
  } catch (e) {
    log.push({ step: "landing", error: String(e) });
  }

  // в”Ђв”Ђ РЎРїРѕСЃРѕР± 3: РїРѕСЃР»РµРґРЅРёР№ Р»Р°Р№РєРЅСѓС‚С‹Р№ С‚СЂРµРє в”Ђв”Ђ
  try {
    if (uid) {
      const likes = await get(API + "/users/" + uid + "/likes/tracks", headers);
      const list = likes?.result?.library?.tracks;
      log.push({ step: "likes", count: list?.length ?? 0 });
      if (list?.length) {
        const id = String(list[0].id).split(":")[0];
        const track = (await get(API + "/tracks/" + id, headers))?.result?.[0];
        if (track) return finish({ playing: false, title: track.title, artist: names(track.artists) }, "likes");
      }
    }
  } catch (e) {
    log.push({ step: "likes", error: String(e) });
  }

  if (debug) return json({ log }, 200, "debug");
  errorUntil = Date.now() + ERROR_TTL;
  return json(cache.data || { playing: false }, 200, "none");

  function finish(data, source) {
    if (debug) return json({ log, source, data }, 200, "debug");
    cache = { at: Date.now(), data };
    errorUntil = 0;
    return json(data, 200, "miss");
  }
};

// СЂРµРєСѓСЂСЃРёРІРЅРѕ РёС‰РµРј РѕР±СЉРµРєС‚, РїРѕС…РѕР¶РёР№ РЅР° С‚СЂРµРє (РµСЃС‚СЊ title Рё artists)
function findTrack(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  if (typeof obj.title === "string" && Array.isArray(obj.artists)) return obj;
  for (const v of Object.values(obj)) {
    const found = findTrack(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function names(artists) {
  return (artists || []).map(a => a.name).join(", ");
}

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("yandex " + res.status);
  return res.json();
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
