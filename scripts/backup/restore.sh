#!/bin/sh
# Restauro de uma cópia de segurança do OpenCRM.
#
#   restore.sh <ficheiro.dump> [--files <ficheiro.tar.gz>] --yes
#
# ATENÇÃO: SUBSTITUI a base de dados atual (e, com --files, os anexos) pelo conteúdo da cópia.
# Antes de restaurar, pára a aplicação:   docker compose stop backend email-worker
# Para restaurar anexos pára também o MinIO:   docker compose stop minio
# Os nomes podem ser dados só pelo nome do ficheiro (ex.: opencrm-20261106-120000.dump).
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MINIO_DIR="${MINIO_DIR:-/minio}"

die() { echo "[restore] ERRO: $*" >&2; exit 1; }
log() { echo "[restore] $*"; }

dump=""; files=""; confirmed="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) confirmed="yes" ;;
    --files) shift; files="${1:-}"; [ -n "$files" ] || die "--files precisa de um ficheiro" ;;
    -*) die "opção desconhecida: $1" ;;
    *) [ -z "$dump" ] || die "indica só um ficheiro de base de dados"; dump="$1" ;;
  esac
  shift
done
[ -n "$dump" ] || die "indica o ficheiro de cópia da base de dados (ver: backup.sh list)"

resolve() { # caminho absoluto, relativo, ou só o nome dentro da pasta de cópias
  if [ -f "$1" ]; then echo "$1"; elif [ -f "$BACKUP_DIR/$2/$1" ]; then echo "$BACKUP_DIR/$2/$1"; else echo ""; fi
}

dump_path="$(resolve "$dump" db)"
[ -n "$dump_path" ] || die "ficheiro não encontrado: $dump"
files_path=""
if [ -n "$files" ]; then
  files_path="$(resolve "$files" files)"
  [ -n "$files_path" ] || die "ficheiro de anexos não encontrado: $files"
fi

# 1) Valida os ficheiros ANTES de tocar em qualquer coisa: um ficheiro corrompido nunca chega a apagar dados.
pg_restore --list "$dump_path" > /dev/null 2>&1 || die "a cópia da base de dados está corrompida ou não é um ficheiro válido: $dump_path"
if [ -n "$files_path" ]; then
  tar tzf "$files_path" > /dev/null 2>&1 || die "a cópia dos anexos está corrompida: $files_path"
  # O MinIO a correr enquanto se substitui o seu volume corrompia os dados dele.
  if wget -q -T 3 -O /dev/null "http://minio:9000/minio/health/live" 2> /dev/null; then
    die "o MinIO está a correr. Pára-o primeiro:  docker compose stop minio"
  fi
fi

# 2) Confirmação explícita: isto substitui dados.
if [ "$confirmed" != "yes" ]; then
  echo "[restore] Isto vai SUBSTITUIR a base de dados '${PGDATABASE:-?}' pelo conteúdo de:" >&2
  echo "           $dump_path" >&2
  [ -n "$files_path" ] && echo "           e os anexos por: $files_path" >&2
  echo "[restore] Nada foi alterado. Para continuar repete o comando com --yes" >&2
  exit 2
fi

# 3) Base de dados — numa única transação: se algo falhar a meio, a base atual fica intacta (rollback).
log "a restaurar a base de dados de $dump_path ..."
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error \
  -d "$PGDATABASE" "$dump_path" || die "o restauro falhou; a base de dados atual NÃO foi alterada (transação revertida)"
log "base de dados restaurada"

# 4) Anexos (opcional).
if [ -n "$files_path" ]; then
  [ -d "$MINIO_DIR" ] || die "volume do MinIO não está montado em $MINIO_DIR"
  log "a restaurar os anexos de $files_path ..."
  find "$MINIO_DIR" -mindepth 1 -delete
  tar xzf "$files_path" -C "$MINIO_DIR"
  log "anexos restaurados"
fi

log "concluído. Volta a arrancar a aplicação:  docker compose up -d"
