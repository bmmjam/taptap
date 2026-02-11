import os
import json
import asyncio
import random
import string
from datetime import datetime
from pathlib import Path

from aiohttp import web
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    MenuButtonWebApp, WebAppInfo,
    ReplyKeyboardMarkup, KeyboardButton,
    BotCommand,
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

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- File paths ---
DATA_DIR = Path(__file__).parent
DATASET_FILE = DATA_DIR / "dataset.jsonl"
USERS_FILE = DATA_DIR / "users.jsonl"
ROOMS_FILE = DATA_DIR / "rooms.json"

# --- Persistent storage ---
rooms = {}  # code -> {name, creator_id, created_at}

# --- In-memory state ---
rooms_results = {}  # room_code -> {user_id: {name, emotion, emoji, stats, timestamp}}
user_rooms = {}     # user_id -> room_code

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


# --- Persistence helpers ---

def load_rooms():
    global rooms
    if ROOMS_FILE.exists():
        with open(ROOMS_FILE, "r", encoding="utf-8") as f:
            rooms = json.load(f)
    else:
        rooms = {}


def save_rooms():
    with open(ROOMS_FILE, "w", encoding="utf-8") as f:
        json.dump(rooms, f, ensure_ascii=False, indent=2)


def save_user(user_id, name, username, room_code):
    entry = {
        "user_id": user_id,
        "name": name,
        "username": username,
        "room_code": room_code,
        "timestamp": datetime.now().isoformat(),
    }
    with open(USERS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def generate_room_code():
    while True:
        code = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
        if code not in rooms:
            return code


def make_webapp_url(room_code=None):
    url = WEBAPP_BASE + ("&" if "?" in WEBAPP_BASE else "?") + "api=" + API_URL
    if room_code:
        url += "&room=" + room_code
    return url


def get_room_results(room_code):
    return rooms_results.get(room_code, {})


def build_group_summary(room_code):
    results = get_room_results(room_code)
    room_name = rooms.get(room_code, {}).get("name", room_code)

    if not results:
        return "\U0001F465 Комната **" + room_name + "** \u2014 пока никто не прошёл тест."

    members = list(results.values())
    total = len(members)
    counts = {}
    for m in members:
        counts[m["emotion"]] = counts.get(m["emotion"], 0) + 1
    dominant = max(counts, key=counts.get)

    lines = [
        "\U0001F465 **" + room_name + "** (" + str(total) + " чел.)\n",
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
            m["emoji"] + " " + m["name"] + " \u2014 "
            + EMOTION_TITLES.get(m["emotion"], m["emotion"])
        )
    return "\n".join(lines)


# ── Telegram handlers ──


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    user_id = message.from_user.id
    name = message.from_user.first_name or "Аноним"
    username = message.from_user.username or ""

    # Parse deep link: /start r_XXXXXX
    args = message.text.split(maxsplit=1)
    room_code = None
    if len(args) > 1 and args[1].startswith("r_"):
        room_code = args[1][2:]
        if room_code not in rooms:
            await message.answer(
                "\u274C Комната не найдена. Попросите организатора прислать актуальную ссылку.",
            )
            return

    # Track user
    save_user(user_id, name, username, room_code)

    if room_code:
        # Join room
        user_rooms[user_id] = room_code
        room_name = rooms[room_code]["name"]
        webapp_url = make_webapp_url(room_code)

        await bot.set_chat_menu_button(
            chat_id=message.chat.id,
            menu_button=MenuButtonWebApp(
                text="TapTap",
                web_app=WebAppInfo(url=webapp_url),
            ),
        )
        keyboard = ReplyKeyboardMarkup(
            keyboard=[[KeyboardButton(
                text="\U0001F60A Узнать моё состояние",
                web_app=WebAppInfo(url=webapp_url),
            )]],
            resize_keyboard=True,
        )
        await message.answer(
            "\U0001F44B Привет! Ты в комнате **" + room_name + "**.\n\n"
            "Нажми кнопку внизу \u2014 потапай по смайлику "
            "и увидишь свой результат.\n\n"
            "/group \u2014 обстановка в комнате",
            reply_markup=keyboard,
            parse_mode="Markdown",
        )
    else:
        # No room — show instructions
        await message.answer(
            "\U0001F44B Привет! Я **TapTap** \u2014 помогу понять "
            "эмоциональное состояние группы.\n\n"
            "\U0001F4CB **Для организаторов:**\n"
            "/newroom Название \u2014 создать комнату для мероприятия.\n"
            "Участники получат ссылку и смогут пройти тест.\n\n"
            "\U0001F464 **Для участников:**\n"
            "Попросите организатора прислать ссылку на комнату.",
            parse_mode="Markdown",
        )


@dp.message(Command("newroom"))
async def cmd_newroom(message: types.Message):
    args = message.text.split(maxsplit=1)
    if len(args) < 2 or not args[1].strip():
        await message.answer(
            "\u270D\uFE0F Укажите название:\n"
            "`/newroom Название мероприятия`",
            parse_mode="Markdown",
        )
        return

    room_name = args[1].strip()
    code = generate_room_code()
    rooms[code] = {
        "name": room_name,
        "creator_id": message.from_user.id,
        "created_at": datetime.now().isoformat(),
    }
    save_rooms()

    # Auto-join creator
    user_rooms[message.from_user.id] = code

    bot_info = await bot.get_me()
    link = "https://t.me/" + bot_info.username + "?start=r_" + code

    await message.answer(
        "\u2705 Комната **" + room_name + "** создана!\n\n"
        "\U0001F517 Ссылка для участников:\n"
        "`" + link + "`\n\n"
        "Отправьте эту ссылку участникам. "
        "Они нажмут на неё и сразу попадут в вашу комнату.\n\n"
        "/group \u2014 посмотреть обстановку\n"
        "/reset \u2014 сбросить результаты (только для вас как организатора)",
        parse_mode="Markdown",
    )


@dp.message(Command("group"))
async def cmd_group(message: types.Message):
    user_id = message.from_user.id
    room_code = user_rooms.get(user_id)
    if not room_code or room_code not in rooms:
        await message.answer(
            "\U0001F6AA Ты не в комнате. "
            "Попроси организатора прислать ссылку или создай свою: /newroom",
        )
        return
    await message.answer(build_group_summary(room_code), parse_mode="Markdown")


@dp.message(Command("reset"))
async def cmd_reset(message: types.Message):
    user_id = message.from_user.id
    room_code = user_rooms.get(user_id)
    if not room_code or room_code not in rooms:
        await message.answer("\U0001F6AA Ты не в комнате.")
        return
    if rooms[room_code]["creator_id"] != user_id:
        await message.answer("\u26D4 Только организатор комнаты может сбросить результаты.")
        return
    rooms_results.pop(room_code, None)
    await message.answer("\u2705 Результаты комнаты сброшены. Можно начинать новый раунд!")


@dp.message(lambda m: m.web_app_data is not None)
async def handle_webapp_data(message: types.Message):
    try:
        data = json.loads(message.web_app_data.data)
        emotion = data.get("emotion", "calm")
        user_id = message.from_user.id
        name = message.from_user.first_name or "Аноним"
        room_code = user_rooms.get(user_id)

        if room_code:
            if room_code not in rooms_results:
                rooms_results[room_code] = {}
            rooms_results[room_code][user_id] = {
                "name": name,
                "emotion": emotion,
                "emoji": EMOJI_MAP.get(emotion, "\U0001F60C"),
                "stats": data.get("stats", {}),
                "timestamp": datetime.now().isoformat(),
            }
            room_count = len(rooms_results[room_code])
        else:
            room_count = 0

        title = EMOTION_TITLES.get(emotion, emotion)
        text = (
            EMOJI_MAP.get(emotion, "") + " **" + name
            + "**, твоё состояние: **" + title + "**"
        )
        if room_code:
            text += (
                "\n\nВ комнате " + str(room_count) + " чел. "
                "Напиши /group чтобы увидеть обстановку."
            )
        await message.answer(text, parse_mode="Markdown")
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
        uid = str(data.get("user_id", "anon"))
        name = data.get("name", "Аноним")
        emotion = data.get("emotion", "calm")
        room_code = data.get("room", "")

        if room_code:
            if room_code not in rooms_results:
                rooms_results[room_code] = {}
            rooms_results[room_code][uid] = {
                "name": name,
                "emotion": emotion,
                "emoji": EMOJI_MAP.get(emotion, "\U0001F60C"),
                "stats": data.get("stats", {}),
                "timestamp": datetime.now().isoformat(),
            }
            count = len(rooms_results[room_code])
        else:
            count = 0

        return web.json_response({"ok": True, "count": count})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


async def handle_get_results(request):
    room_code = request.query.get("room", "")
    results = get_room_results(room_code) if room_code else {}
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


async def handle_post_dataset(request):
    try:
        data = await request.json()
        data["server_timestamp"] = datetime.now().isoformat()
        with open(DATASET_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(data, ensure_ascii=False) + "\n")
        return web.json_response({"ok": True})
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)


async def start_api():
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_route("OPTIONS", "/api/{tail:.*}", handle_options)
    app.router.add_post("/api/result", handle_post_result)
    app.router.add_get("/api/results", handle_get_results)
    app.router.add_post("/api/dataset", handle_post_dataset)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", 8080)
    await site.start()
    print("API server running on http://0.0.0.0:8080")


async def main():
    print("Starting TapTap bot + API server...")
    load_rooms()
    await bot.set_my_commands([
        BotCommand(command="start", description="Запустить бота"),
        BotCommand(command="newroom", description="Создать комнату"),
        BotCommand(command="group", description="Обстановка в комнате"),
    ])
    await start_api()
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
