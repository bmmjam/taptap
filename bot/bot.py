import os
import asyncio
from aiogram import Bot, Dispatcher, types
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardMarkup, InlineKeyboardButton,
    MenuButtonWebApp, WebAppInfo,
    ReplyKeyboardMarkup, KeyboardButton,
)

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")

if not BOT_TOKEN:
    raise SystemExit("BOT_TOKEN environment variable is not set.\n"
                     "Get one from @BotFather and run:\n"
                     "  export BOT_TOKEN='your-token-here'")

if not WEBAPP_URL:
    raise SystemExit("WEBAPP_URL environment variable is not set.\n"
                     "Set it to your GitHub Pages URL, e.g.:\n"
                     "  export WEBAPP_URL='https://username.github.io/taptap/webapp/'")

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    # Set the Menu Button (appears near the text input field)
    await bot.set_chat_menu_button(
        chat_id=message.chat.id,
        menu_button=MenuButtonWebApp(
            text="TapTap",
            web_app=WebAppInfo(url=WEBAPP_URL),
        ),
    )

    # Reply keyboard with a big button to open the app
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
        "и я расскажу о твоём эмоциональном состоянии.",
        reply_markup=keyboard,
        parse_mode="Markdown",
    )


async def main():
    print("Bot started. Press Ctrl+C to stop.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
