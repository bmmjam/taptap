# Запуск TapTap

## 1. Туннель (отдельный терминал)

```bash
/tmp/cloudflared tunnel --url http://localhost:8080
```

Скопируй URL вида `https://xxx-xxx.trycloudflare.com`

## 2. Бот (другой терминал)

```bash
cd ~/Git/taptap
export BOT_TOKEN='8589801108:AAFn3Pjv_se2IbOqk1fCIZGQIAXtkqE7ZlE'
export WEBAPP_URL='https://bmmjam.github.io/taptap/webapp/'
export API_URL='https://xxx-xxx.trycloudflare.com'  # URL из шага 1
bot/.venv/bin/python bot/bot.py
```

## 3. В Telegram

Напиши `/start` боту — появится кнопка для входа в мини-апп.

## Во время мероприятия

- `/reset` — сброс между раундами (до/после)
- `/group` — текстовая статистика в чате
- Не закрывай ноутбук, не перезапускай туннель
