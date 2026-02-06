import os
import json
import asyncio
from datetime import datetime
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    MenuButtonWebApp, WebAppInfo,
    ReplyKeyboardMarkup, KeyboardButton,
)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")

if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN is not set")

if not WEBAPP_URL:
    raise SystemExit("WEBAPP_URL is not set")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# --- In-memory results storage ---
results = {}  # user_id -> {name, emotion, emoji, title, stats, timestamp}

EMOTION_TITLES = {
    "stressed": "Стресс",
    "excited": "Энергия",
    "calm": "Спокойствие",
    "anxious": "Тревога",
    "focused": "Фокус",
    "sad": "Грусть",
}


def build_group_summary():
    if not results:
        return "\U0001F465 Пока никто не прошёл тест."

    members = list(results.values())
    total = len(members)

    # Count emotions
    counts = {}
    for m in members:
        counts[m["emotion"]] = counts.get(m["emotion"], 0) + 1

    # Dominant emotion
    dominant = max(counts, key=counts.get)
    dominant_emoji = members[0]["emoji"]
    for m in members:
        if m["emotion"] == dominant:
            dominant_emoji = m["emoji"]
            break

    lines = []
    lines.append("\U0001F465 **Обстановка в группе** (" + str(total) + " чел.)\n")
    lines.append(dominant_emoji + " Общее настроение: **" +
                 EMOTION_TITLES.get(dominant, dominant) + "**\n")

    # Bars
    bar_full = "\u2588"
    bar_empty = "\u2591"
    for emotion in ["stressed", "excited", "calm", "anxious", "focused", "sad"]:
        count = counts.get(emotion, 0)
        if count == 0:
            continue
        pct = round(count / total * 100)
        bar_len = max(1, round(count / total * 10))
        bar = bar_full * bar_len + bar_empty * (10 - bar_len)
        emoji_map = {
            "stressed": "\U0001F624", "excited": "\U0001F929",
            "calm": "\U0001F60C", "anxious": "\U0001F61F",
            "focused": "\U0001F9D0", "sad": "\U0001F614",
        }
        lines.append(emoji_map.get(emotion, "") + " " + bar + " " +
                     str(pct) + "% " + EMOTION_TITLES.get(emotion, emotion))

    lines.append("\n\U0001F4CB **Участники:**")
    for m in members:
        lines.append(m["emoji"] + " " + m["name"] + " — " +
                     EMOTION_TITLES.get(m["emotion"], m["emotion"]))

    return "\n".join(lines)


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
        keyboard=[
            [KeyboardButton(
                text="\U0001F60A Узнать моё состояние",
                web_app=WebAppInfo(url=WEBAPP_URL),
            )]
        ],
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
        emoji_map = {
            "stressed": "\U0001F624", "excited": "\U0001F929",
            "calm": "\U0001F60C", "anxious": "\U0001F61F",
            "focused": "\U0001F9D0", "sad": "\U0001F614",
        }
        emoji = emoji_map.get(emotion, "\U0001F60C")
        user_id = message.from_user.id
        name = message.from_user.first_name or "Аноним"

        results[user_id] = {
            "name": name,
            "emotion": emotion,
            "emoji": emoji,
            "stats": data.get("stats", {}),
            "timestamp": datetime.now().isoformat(),
        }

        title = EMOTION_TITLES.get(emotion, emotion)
        await message.answer(
            emoji + " **" + name + "**, твоё состояние: **" + title + "**\n\n"
            "Сейчас в группе " + str(len(results)) + " чел. "
            "Напиши /group чтобы увидеть общую обстановку.",
            parse_mode="Markdown",
        )
    except Exception:
        await message.answer("Не удалось обработать результат.")


async def main():
    print("Bot started. Press Ctrl+C to stop.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
