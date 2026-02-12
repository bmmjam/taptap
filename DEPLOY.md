# Деплой TapTap на сервер

## Вариант 1: VPS + Cloudflare Tunnel (проще всего)

Подходит любой VPS за ~$4-5/мес: Hetzner, Timeweb, Aeza, DigitalOcean.

### 1. Подготовка сервера

```bash
# SSH на сервер
ssh root@YOUR_SERVER_IP

# Обновить пакеты
apt update && apt upgrade -y

# Установить Python 3.11+ и git
apt install -y python3 python3-venv git

# Создать пользователя (не работать от root)
adduser taptap --disabled-password
su - taptap
```

### 2. Склонировать проект

```bash
cd ~
git clone https://github.com/bmmjam/taptap.git
cd taptap/bot
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Установить cloudflared

```bash
# От root:
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### 4. Создать systemd-сервис для tunnel

```bash
# От root — создать файл:
cat > /etc/systemd/system/cloudflared.service << 'EOF'
[Unit]
Description=Cloudflare Tunnel
After=network.target

[Service]
Type=simple
User=taptap
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:8080
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

> **Проблема**: quick tunnel даёт случайный URL при каждом перезапуске.
> Чтобы URL был постоянным — нужен **named tunnel** (см. раздел ниже).

### 5. Создать systemd-сервис для бота

```bash
cat > /etc/systemd/system/taptap.service << 'EOF'
[Unit]
Description=TapTap Bot
After=network.target

[Service]
Type=simple
User=taptap
WorkingDirectory=/home/taptap/taptap
Environment=BOT_TOKEN=8589801108:AAFn3Pjv_se2IbOqk1fCIZGQIAXtkqE7ZlE
Environment=WEBAPP_URL=https://bmmjam.github.io/taptap/webapp/
Environment=API_URL=https://YOUR-TUNNEL-URL.trycloudflare.com
ExecStart=/home/taptap/taptap/bot/.venv/bin/python bot/bot.py
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

### 6. Запустить

```bash
systemctl daemon-reload
systemctl enable cloudflared taptap
systemctl start cloudflared

# Подождать ~10 сек, посмотреть URL туннеля:
journalctl -u cloudflared --no-pager | grep trycloudflare.com

# Обновить API_URL в сервисе бота на полученный URL, затем:
systemctl start taptap
```

### 7. Проверить

```bash
# Статус сервисов
systemctl status cloudflared
systemctl status taptap

# Логи
journalctl -u taptap -f
journalctl -u cloudflared -f

# Тест API
curl http://localhost:8080/api/results
```

---

## Вариант 2: Named Tunnel (постоянный URL)

Quick tunnel меняет URL при каждом перезапуске. Чтобы этого избежать:

### 1. Создать аккаунт Cloudflare (бесплатно)

### 2. Авторизовать cloudflared

```bash
cloudflared tunnel login
```

### 3. Создать named tunnel

```bash
cloudflared tunnel create taptap
# Запомнить Tunnel ID (например: a1b2c3d4-...)
```

### 4. Привязать домен

В Cloudflare DNS добавить CNAME-запись:
```
api.yourdomain.com → a1b2c3d4-....cfargotunnel.com
```

### 5. Конфиг tunnel

```bash
cat > ~/.cloudflared/config.yml << EOF
tunnel: a1b2c3d4-...
credentials-file: /home/taptap/.cloudflared/a1b2c3d4-....json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
EOF
```

### 6. Обновить systemd

```ini
ExecStart=/usr/local/bin/cloudflared tunnel run taptap
```

И в `taptap.service`:
```ini
Environment=API_URL=https://api.yourdomain.com
```

---

## Полезные команды

```bash
# Перезапустить бота после обновления кода
cd /home/taptap/taptap && git pull
sudo systemctl restart taptap

# Посмотреть собранный датасет
cat /home/taptap/taptap/bot/dataset.jsonl | wc -l   # кол-во записей
tail -1 /home/taptap/taptap/bot/dataset.jsonl        # последняя запись

# Бэкап датасета
scp taptap@SERVER:/home/taptap/taptap/bot/dataset.jsonl ./dataset_backup.jsonl
```

## Чеклист

- [ ] VPS арендован
- [ ] Python 3.11+ установлен
- [ ] Проект склонирован, venv создан
- [ ] cloudflared установлен
- [ ] systemd-сервисы созданы и включены
- [ ] API_URL обновлён в taptap.service
- [ ] Бот отвечает на /start в Telegram
- [ ] dataset.jsonl записывается после прохождения теста
