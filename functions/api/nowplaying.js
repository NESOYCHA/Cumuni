// Cloudflare Pages Function: что сейчас играет.
// Секреты задаются в панели Cloudflare (Settings → Variables and secrets).

const YA = "https://api.music.yandex.net";
const LFM = "https://ws.audioscrobbler.com/2.0/";

export async function onRequest(context) {
  const env = context.env;

  // ── Основной источник: Last.fm ──
  const user = env.LASTFM_USER?.trim();
  const key = env.LASTFM_KEY?.trim();

  if (user && key) {
    try {
      const url = LFM + "?method=user.getrecenttracks&user=" + encodeURIComponent(user)
        + "&api_key=" + encodeURIComponent(key) + "&format=json&limit=1";
      const data = await get(url, {});
      const t = data?.recenttracks?.track;
      const track = Array.isArray(t) ? t[0] : t;

      if (track?.name) {
        const artist = track.artist?.["#text"] || track.artist?.name || "";
        let cover = pickCover(track.image);
        if (!cover) cover = await yandexCover(env, track.name, artist);

        return json({
          playing: track["@attr"]?.nowplaying === "true",
          title: track.name,
          artist,
          url: track.url || null,
          cover,
        });
      }
    } catch (e) { /* пробуем запасной источник */ }
  }

  // ── Запасной источник: последний лайк в Яндексе ──
  const token = env.YANDEX_MUSIC_TOKEN?.trim();
  if (token) {
    const headers = yaHeaders(token);
    try {
      const acc = await get(YA + "/account/status", headers);
      const uid = acc?.result?.account?.uid;
      const likes = await get(YA + "/users/" + uid + "/likes/tracks", headers);
      const list = likes?.result?.library?.tracks;

      if (list?.length) {
        const id = String(list[0].id).split(":")[0];
        const track = (await get(YA + "/tracks/" + id, headers))?.result?.[0];
        if (track) {
          const albumId = track.albums?.[0]?.id;
          const uri = track.coverUri || track.albums?.[0]?.coverUri;
          return json({
            playing: false,
            liked: true,
            title: track.title,
            artist: (track.artists || []).map(a => a.name).join(", "),
            url: albumId
              ? "https://music.yandex.ru/album/" + albumId + "/track/" + id
              : "https://music.yandex.ru/track/" + id,
            cover: uri ? "https://" + uri.replace("%%", "400x400") : null,
          });
        }
      }
    } catch (e) { /* оба источника молчат */ }
  }

  return json({ playing: false });
}

function yaHeaders(token) {
  return {
    "Authorization": "OAuth " + token,
    "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
    "User-Agent": "Yandex-Music-API",
  };
}

async function yandexCover(env, title, artist) {
  const token = env.YANDEX_MUSIC_TOKEN?.trim();
  if (!token || !title) return null;
  try {
    const q = encodeURIComponent((artist ? artist + " " : "") + title);
    const res = await get(YA + "/search?type=track&page=0&nocorrect=false&text=" + q, yaHeaders(token));
    const found = res?.result?.tracks?.results?.[0];
    const uri = found?.coverUri || found?.albums?.[0]?.coverUri;
    return uri ? "https://" + uri.replace("%%", "400x400") : null;
  } catch (e) {
    return null;
  }
}

const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";
function pickCover(images) {
  if (!Array.isArray(images)) return null;
  const best = images[images.length - 1]?.["#text"] || images[0]?.["#text"];
  if (!best || best.includes(PLACEHOLDER)) return null;
  return best;
}

async function get(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=20",
    },
  });
                                 }
