// Гостевая: принимает сообщение с сайта и шлёт его в телеграм владельцу.
// Нужны переменные TG_BOT_TOKEN (токен бота от @BotFather) и TG_CHAT_ID (твой chat id).

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = env.TG_BOT_TOKEN?.trim();
  const chatId = env.TG_CHAT_ID?.trim();
  if (!token || !chatId) {
    return json({ ok: false, error: "guestbook not configured" }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "bad request" }, 400);
  }

  // ловушка для ботов: скрытое поле должно быть пустым
  if (form.get("bot-field")) return json({ ok: true });

  const name = String(form.get("name") || "").slice(0, 60).trim();
  const message = String(form.get("message") || "").slice(0, 1000).trim();
  if (!name || !message) return json({ ok: false, error: "empty" }, 400);

  const text = "📮 Гостевая cumuni\n\nОт: " + name + "\n\n" + message;

  try {
    const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) throw new Error();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "telegram error" }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
