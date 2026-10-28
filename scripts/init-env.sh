#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  printf '%s\n' '.env уже существует; оставлен без изменений.'
  exit 0
fi
umask 077
password=$(openssl rand -hex 24)
sed "s/replace_with_random_local_password/$password/" .env.example > .env
printf '%s\n' 'Создан .env со случайным локальным паролем БД. Не добавляйте его в Git.'
