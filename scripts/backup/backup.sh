#!/bin/sh
# Cópias de segurança do OpenCRM (base de dados + anexos). Corre no serviço "backup" do docker-compose.yml.
#
#   backup.sh loop                      uma cópia ao arrancar e depois a cada BACKUP_INTERVAL_HOURS (omissão do serviço)
#   backup.sh once                      uma cópia agora
#   backup.sh list                      lista as cópias existentes
#   backup.sh restore <ficheiro> [...]  restaura (ver restore.sh)
#
# Ver docs/plano-backups.md.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
MINIO_DIR="${MINIO_DIR:-/minio}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# Apaga cópias com mais de KEEP_DAYS dias, mas NUNCA a mais recente (a pasta não pode ficar sem cópias).
prune() {
  dir="$1"; pattern="$2"
  newest="$(ls -1t "$dir"/$pattern 2>/dev/null | head -n 1 || true)"
  find "$dir" -name "$pattern" -mtime +"$KEEP_DAYS" | while read -r old; do
    if [ "$old" != "$newest" ]; then
      rm -f "$old"
      log "removida cópia antiga: $old"
    fi
  done
}

human_size() { du -h "$1" | cut -f1; }

do_backup() {
  ts="$(date -u +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"

  # --- base de dados -------------------------------------------------------------------------------
  dump="$BACKUP_DIR/db/opencrm-$ts.dump"
  # Escreve para um ficheiro temporário: uma cópia interrompida nunca aparece como válida.
  if ! pg_dump -Fc --no-owner --no-privileges -f "$dump.partial"; then
    rm -f "$dump.partial"
    log "ERRO: o pg_dump falhou — nenhuma cópia da base de dados foi criada"
    return 1
  fi
  # Uma cópia corrompida é pior do que nenhuma (dá falsa segurança): confirma que o ficheiro se consegue ler.
  if ! pg_restore --list "$dump.partial" > /dev/null 2>&1; then
    rm -f "$dump.partial"
    log "ERRO: a cópia da base de dados ficou ilegível e foi descartada"
    return 1
  fi
  mv "$dump.partial" "$dump"
  log "base de dados guardada: $dump ($(human_size "$dump"))"

  # --- anexos (MinIO) ------------------------------------------------------------------------------
  # Sem parar o MinIO: são objetos imutáveis; um anexo a meio de ser escrito entra na cópia seguinte.
  if [ -d "$MINIO_DIR" ]; then
    files="$BACKUP_DIR/files/minio-$ts.tar.gz"
    # O tar pode avisar ("ficheiro mudou durante a leitura") e sair com código 1 sem o arquivo estar mau:
    # por isso o que decide é o arquivo ser legível até ao fim, não o código de saída.
    tar czf "$files.partial" -C "$MINIO_DIR" . 2> /dev/null || true
    if [ -s "$files.partial" ] && tar tzf "$files.partial" > /dev/null 2>&1; then
      mv "$files.partial" "$files"
      log "anexos guardados: $files ($(human_size "$files"))"
    else
      rm -f "$files.partial"
      log "AVISO: não foi possível copiar os anexos (a base de dados ficou guardada)"
    fi
  fi

  prune "$BACKUP_DIR/db" "opencrm-*.dump"
  prune "$BACKUP_DIR/files" "minio-*.tar.gz"
}

list_backups() {
  echo "Base de dados ($BACKUP_DIR/db):"
  ls -1t "$BACKUP_DIR"/db/opencrm-*.dump 2> /dev/null | while read -r f; do echo "  $(basename "$f")  $(human_size "$f")"; done
  echo "Anexos ($BACKUP_DIR/files):"
  ls -1t "$BACKUP_DIR"/files/minio-*.tar.gz 2> /dev/null | while read -r f; do echo "  $(basename "$f")  $(human_size "$f")"; done
}

case "${1:-loop}" in
  once)
    do_backup
    ;;
  loop)
    # Se uma cópia falhar o contentor termina com erro: fica visível em "docker compose ps" e nos logs, e o
    # Docker volta a arrancá-lo (restart: unless-stopped), o que repete a tentativa.
    while true; do
      do_backup || { log "a terminar com erro para ser visível e repetido"; exit 1; }
      log "próxima cópia dentro de ${INTERVAL_HOURS}h"
      sleep "$((INTERVAL_HOURS * 3600))"
    done
    ;;
  list)
    list_backups
    ;;
  restore)
    shift
    exec sh "$(dirname "$0")/restore.sh" "$@"
    ;;
  *)
    echo "uso: backup.sh loop|once|list|restore <ficheiro> [--files <ficheiro.tar.gz>] --yes" >&2
    exit 64
    ;;
esac
