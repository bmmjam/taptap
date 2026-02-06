import os
import json
import asyncio
from datetime import datetime

from aiohttp import web
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    MenuButtonWebApp, WebAppInfo,
    ReplyKeyboardMarkup, KeyboardButton,
)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBAPP_BASE = os.environ.get(
    "WEBAPP_URL", "https://bmmjam.github.io/taptap/webapp/"
)
API_URL = os.environ.get("API_URL", "")

if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN is not set")
if not API_URL:
    raise SystemExit("API_URL is not set")

WEBAPP_URL = WEBAPP_BASE + ("&" if "?" in WEBAPP_BASE else "?") + "api=" + API_URL

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- In-memory results storage ---
results = {}  # user_id -> {name, emotion, emoji, stats, timestamp}

EMOTION_TITLES = {
    "stressed": "Стресс", "excited": "Энергия", "calm": "Спокойствие",
    "anxious": "Тревога", "focused": "Фокус", "sad": "Грусть",
}
EMOJI_MAP = {
    "stressed": "\U0001F624", "excited": "\U0001F929",
    "calm": "\U0001F60C", "anxious": "\U0001F61F",
    "focused": "\U0001F9D0", "sad": "\U0001F614",
}
EMOTION_COLORS = {
    "stressed": "#FF6B6B", "excited": "#FFA94D", "calm": "#69DB7C",
    "anxious": "#DA77F2", "focused": "#74C0FC", "sad": "#748FFC",
}


def build_group_summary():
    if not results:
        return "\U0001F465 Пока никто не прошёл тест."

    members = list(results.values())
    total = len(members)
    counts = {}
    for m in members:
        counts[m["emotion"]] = counts.get(m["emotion"], 0) + 1
    dominant = max(counts, key=counts.get)

    lines = [
        "\U0001F465 **Обстановка в группе** (" + str(total) + " чел.)\n",
        EMOJI_MAP.get(dominant, "") + " Общее настроение: **"
        + EMOTION_TITLES.get(dominant, dominant) + "**\n",
    ]
    bar_full, bar_empty = "\u2588", "\u2591"
    for emotion in ["stressed", "excited", "calm", "anxious", "focused", "sad"]:
        count = counts.get(emotion, 0)
        if count == 0:
            continue
        pct = round(count / total * 100)
        bar_len = max(1, round(count / total * 10))
        bar = bar_full * bar_len + bar_empty * (10 - bar_len)
        lines.append(
            EMOJI_MAP.get(emotion, "") + " " + bar + " "
            + str(pct) + "% " + EMOTION_TITLES.get(emotion, emotion)
        )
    lines.append("\n\U0001F4CB **Участники:**")
    for m in members:
        lines.append(
            m["emoji"] + " " + m["name"] + " — "
            + EMOTION_TITLES.get(m["emotion"], m["emotion"])
        )
    return "\n".join(lines)


# ── Telegram handlers ──


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    await bot.set_chat_menu_button(
        chat_id=message.chat.id,
        menu_button=MenuButtonWebApp(
            text="TapTap",
            web_app=WebAppInfo(url=WEBAPP_URL),
        ),
    )
    keyboard = ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(
            text="\U0001F60A Узнать моё состояние",
            web_app=WebAppInfo(url=WEBAPP_URL),
        )]],
        resize_keyboard=True,
    )
    await message.answer(
        "\U0001F44B Привет! Я **TapTap** — помогу понять, что ты сейчас чувствуешь.\n\n"
        "Нажми кнопку внизу \u2014 потапай по смайлику, "
        "и увидишь свой результат.\n\n"
        "Команда /group \u2014 общая обстановка группы\n"
        "Команда /reset \u2014 сбросить результаты",
        reply_markup=keyboard,
        parse_mode="Markdown",
    )


@dp.message(Command("group"))
async def cmd_group(message: types.Message):
    await message.answer(build_group_summary(), parse_mode="Markdown")


@dp.message(Command("reset"))
async def cmd_reset(message: types.Message):
    results.clear()
    await message.answer("\u2705 Результаты сброшены. Можно начинать новый раунд!")


@dp.message(lambda m: m.web_app_data is not None)
async def handle_webapp_data(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
        emotion = data.get("emotion", "calm")
        user_id = message.from_user.id
        name = message.from_user.first_name or "Аноним"
        results[user_id] = {
            "name": name,
            "emotion": emotion,
            "emoji": EMOJI_MAP.get(emotion, "\U0001F60C"),
            "stats": data.get("stats", {}),
            "timestamp": datetime.now().isoformat(),
        }
        title = EMOTION_TITLES.get(emotion, emotion)
        await message.answer(
            EMOJI_MAP.get(emotion, "") + " **" + name
            + "**, твоё состояние: **" + title + "**\n\n"
            "Сейчас в группе " + str(len(results)) + " чел. "
            "Напиши /group чтобы увидеть общую обстановку.",
            parse_mode="Markdown",
        )
    except Exception:
        await message.answer("Не удалось обработать результат.")


# ── HTTP API (aiohttp) ──


@web.middleware
async def cors_middleware(request, handler):
    resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


async def handle_options(request):
    return web.Response(status=200)


async def handle_post_result(request):
    try:
        data = await request.json()
        uid = str(data.get("user_id", "anon_" + str(len(results))))
        name = data.get("name", "Аноним")
        emotion = data.get("emotion", "calm")
        results[uid] = {
            "name": name,
            "emotion": emotion,
            "emoji": EMOJI_MAP.get(emotion, "\U0001F60C"),
            "stats": data.get("stats", {}),
            "timestamp": datetime.now().isoformat(),
        }
        return web.json_response({"ok": True, "count": len(results)})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


async def handle_get_results(request):
    members = list(results.values())
    counts = {}
    for m in members:
        counts[m["emotion"]] = counts.get(m["emotion"], 0) + 1
    dominant = max(counts, key=counts.get) if counts else "calm"
    return web.json_response({
        "results": members,
        "count": len(members),
        "dominant_emotion": dominant,
        "dominant_title": EMOTION_TITLES.get(dominant, dominant),
        "dominant_emoji": EMOJI_MAP.get(dominant, ""),
        "emotion_counts": counts,
        "emotion_titles": EMOTION_TITLES,
        "emotion_colors": EMOTION_COLORS,
    })


async def handle_api_reset(request):
    results.clear()
    return web.json_response({"ok": True})


async def start_api():
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_route("OPTIONS", "/api/{tail:.*}", handle_options)
    app.router.add_post("/api/result", handle_post_result)
    app.router.add_get("/api/results", handle_get_results)
    app.router.add_post("/api/reset", handle_api_reset)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    print("API server running on http://0.0.0.0:8080")


async def main():
    print("Starting TapTap bot + API server...")
    await start_api()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
