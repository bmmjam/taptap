import os
import asyncio
import json
from datetime import datetime
from aiohttp import web
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import (
    MenuButtonWebApp, WebAppInfo,
    ReplyKeyboardMarkup, KeyboardButton,
)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")
API_URL = os.environ.get("API_URL", "")

if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN is not set")

if not WEBAPP_URL:
    raise SystemExit("WEBAPP_URL is not set")

if not API_URL:
    raise SystemExit("API_URL is not set.\n"
                     "Run ngrok: ngrok http 8080\n"
                     "Then: export API_URL='https://xxxx.ngrok-free.app'")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- In-memory results storage ---
results = []  # [{name, emotion, emoji, stats, timestamp}, ...]


# --- API handlers ---
async def handle_post_result(request):
    try:
        data = await request.json()
        name = data.get("name", "Аноним")
        emotion = data.get("emotion", "")
        emoji = data.get("emoji", "")
        stats = data.get("stats", {})

        # Replace existing result for the same user
        for i, r in enumerate(results):
            if r["name"] == name:
                results[i] = {
                    "name": name,
                    "emotion": emotion,
                    "emoji": emoji,
                    "stats": stats,
                    "timestamp": datetime.now().isoformat(),
                }
                return web.json_response({"ok": True, "updated": True})

        results.append({
            "name": name,
            "emotion": emotion,
            "emoji": emoji,
            "stats": stats,
            "timestamp": datetime.now().isoformat(),
        })
        return web.json_response({"ok": True, "updated": False})
    except Exception as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def handle_get_results(request):
    return web.json_response({"results": results, "count": len(results)})


async def handle_reset(request):
    results.clear()
    return web.json_response({"ok": True})


async def handle_options(request):
    return web.Response(status=200)


@web.middleware
async def cors_middleware(request, handler):
    if request.method == "OPTIONS":
        resp = web.Response(status=200)
    else:
        resp = await handler(request)
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


# --- Bot handlers ---
@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    webapp_url = WEBAPP_URL + "?api=" + API_URL

    await bot.set_chat_menu_button(
        chat_id=message.chat.id,
        menu_button=MenuButtonWebApp(
            text="TapTap",
            web_app=WebAppInfo(url=webapp_url),
        ),
    )

    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(
                text="\U0001F60A Узнать моё состояние",
                web_app=WebAppInfo(url=webapp_url),
            )]
        ],
        resize_keyboard=True,
    )
    await message.answer(
        "\U0001F44B Привет! Я **TapTap** — помогу понять, что ты сейчас чувствуешь.\n\n"
        "Нажми кнопку внизу \u2014 потапай по смайлику, "
        "и увидишь свой результат и общую обстановку группы.",
        reply_markup=keyboard,
        parse_mode="Markdown",
    )


async def main():
    # Start aiohttp web server
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_post("/api/result", handle_post_result)
    app.router.add_get("/api/results", handle_get_results)
    app.router.add_post("/api/reset", handle_reset)
    app.router.add_route("OPTIONS", "/api/result", handle_options)
    app.router.add_route("OPTIONS", "/api/results", handle_options)
    app.router.add_route("OPTIONS", "/api/reset", handle_options)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    print("API server started on http://0.0.0.0:8080")

    # Start bot polling
    print("Bot started. Press Ctrl+C to stop.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
