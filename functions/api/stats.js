// Cloudflare Pages Function: музыкальная статистика за неделю из Last.fm.
// Использует те же переменные LASTFM_USER и LASTFM_KEY, что уже заданы.

const LFM = "https://ws.audioscrobbler.com/2.0/";

export async function onRequest(context) {
  const env = context.env;
  const user = env.LASTFM_USER?.trim();
  const key = env.LASTFM_KEY?.trim();
  if (!user || !key) return json({ error: "not configured" }, 500);

  const base = "&user=" + encodeURIComponent(user)
    + "&api_key=" + encodeURIComponent(key)
    + "&format=json&period=7day&limit=5";

  try {
    const [aRes, tRes] = await Promise.all([
      fetch(LFM + "?method=user.gettopartists" + base).then(r => r.json()),
      fetch(LFM + "?method=user.gettoptracks" + base).then(r => r.json()),
    ]);

    const artists = (aRes?.topartists?.artist || []).map(a => ({
      name: a.name,
      plays: parseInt(a.playcount, 10) || 0,
      url: a.url || null,
    }));

    const tracks = (tRes?.toptracks?.track || []).map(t => ({
      name: t.name,
      artist: t.artist?.name || "",
      plays: parseInt(t.playcount, 10) || 0,
      url: t.url || null,
    }));

    return json({ artists, tracks });
  } catch (e) {
    return json({ error: "lastfm error" }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // статистика меняется медленно — кэшируем на 10 минут
      "Cache-Control": "public, max-age=600",
    },
  });
}
