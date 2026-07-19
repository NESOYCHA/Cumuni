export const config = { path: "/api/nowplaying" };

const YA = "https://api.music.yandex.net";
const LFM = "https://ws.audioscrobbler.com/2.0/";
const TTL = 20 * 1000;
let cache = { at: 0, data: null };

export default async (req) => {
  const debug = new URL(req.url).searchParams.has("debug");
  const now = Date.now();

  if (!debug && cache.data && now - cache.at < TTL) return json(cache.data, 200, "hit");

  const log = [];

  // в”Ђв”Ђ РћСЃРЅРѕРІРЅРѕР№ РёСЃС‚РѕС‡РЅРёРє: Last.fm (СЂРµР°Р»СЊРЅРѕРµ РІСЂРµРјСЏ С‡РµСЂРµР· Pano Scrobbler) в”Ђв”Ђ
  const user = process.env.LASTFM_USER;
  const key = process.env.LASTFM_KEY;

  if (user && key) {
    if (debug) log.push({ step: "config", userLen: user.length, keyLen: key.length, trimmed: key !== key.trim() });
    try {
      const url = LFM + "?method=user.getrecenttracks&user=" + encodeURIComponent(user.trim())
        + "&api_key=" + encodeURIComponent(key.trim()) + "&format=json&limit=1";
      const data = await get(url, {});
      const t = data?.recenttracks?.track;
      const track = Array.isArray(t) ? t[0] : t;
      log.push({ step: "lastfm", found: !!track?.name });

      if (track?.name) {
        return finish({
          playing: track["@attr"]?.nowplaying === "true",
          title: track.name,
          artist: track.artist?.["#text"] || track.artist?.name || "",
        }, "lastfm");
      }
    } catch (e) {
      log.push({ step: "lastfm", error: String(e) });
    }
  } else {
    log.push({ step: "lastfm", skipped: "РЅРµС‚ LASTFM_USER РёР»Рё LASTFM_KEY" });
  }

  // в”Ђв”Ђ Р—Р°РїР°СЃРЅРѕР№ РёСЃС‚РѕС‡РЅРёРє: РїРѕСЃР»РµРґРЅРёР№ Р»Р°Р№Рє РІ РЇРЅРґРµРєСЃРµ в”Ђв”Ђ
  const token = process.env.YANDEX_MUSIC_TOKEN;
  if (token) {
    const headers = {
      "Authorization": "OAuth " + token,
      "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
      "User-Agent": "Yandex-Music-API",
    };
    try {
      const acc = await get(YA + "/account/status", headers);
      const uid = acc?.result?.account?.uid;
      const likes = await get(YA + "/users/" + uid + "/likes/tracks", headers);
      const list = likes?.result?.library?.tracks;
      log.push({ step: "yandex_likes", count: list?.length ?? 0 });

      if (list?.length) {
        const id = String(list[0].id).split(":")[0];
        const track = (await get(YA + "/tracks/" + id, headers))?.result?.[0];
        if (track) {
          return finish({
            playing: false,
            liked: true,
            title: track.title,
            artist: (track.artists || []).map(a => a.name).join(", "),
          }, "yandex_likes");
        }
      }
    } catch (e) {
      log.push({ step: "yandex_likes", error: String(e) });
    }
  }

  if (debug) return json({ log }, 200, "debug");
  return json(cache.data || { playing: false }, 200, "none");

  function finish(data, source) {
    if (debug) return json({ log, source, data }, 200, "debug");
    cache = { at: Date.now(), data };
    return json(data, 200, "miss");
  }
};

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 300); } catch {}
    throw new Error("http " + res.status + " " + body);
  }
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
