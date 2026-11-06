# Plano: cópias de segurança e restauro (2026-11-06)

Último ponto do backlog de produção ([Docker](plano-docker-producao.md)). Hoje os dados vivem em dois volumes Docker (`postgres_data`, `minio_data`) e **não existe nenhuma cópia**: um disco avariado, um `docker compose down -v` por engano ou um ransomware perdem clientes, negócios, notas e anexos. Plano escrito antes de qualquer alteração.

## 1. O que é preciso proteger

| Dados | Onde | Importância |
|---|---|---|
| Tudo o que o CRM guarda (utilizadores, empresas, contactos, leads, negócios, tarefas, timeline, configuração) | volume `postgres_data` | **Crítica** |
| Anexos dos emails | volume `minio_data` | Média (parte recupera-se da caixa de email original) |
| Segredos (`.env`) | ficheiro no servidor | **Fora do âmbito**: não vão para as cópias de propósito (ver §3) |

## 2. Desenho

- **Serviço `backup` no compose** (sidecar, imagem `postgres:16-alpine`, que já traz `pg_dump`/`pg_restore`): corre um ciclo — uma cópia ao arrancar e depois a cada `BACKUP_INTERVAL_HOURS` (24 por omissão). Funciona igual em Windows/Linux, sem depender de cron nem do Agendador de Tarefas do anfitrião.
- Cada cópia = `pg_dump -Fc` (formato comprimido do Postgres, restauro seletivo) + `tar.gz` do volume do MinIO (montado só de leitura). Escritas para um ficheiro temporário e só renomeadas no fim: **uma cópia interrompida nunca aparece como válida**.
- Destino: pasta `./backups/` do anfitrião (bind mount; `BACKUP_DIR` configurável, p. ex. um disco externo ou partilha de rede). Fora do `.git` e do `.dockerignore`.
- **Retenção:** apaga cópias com mais de `BACKUP_KEEP_DAYS` (14 por omissão), mas **nunca apaga a mais recente** nem deixa a pasta vazia.
- **Verificação:** depois de cada dump corre `pg_restore --list` ao ficheiro; se falhar, a cópia é apagada e o erro fica no log (uma cópia corrompida é pior do que nenhuma porque dá falsa segurança).
- **Restauro:** `scripts/restore.sh`, executado pelo mesmo serviço (`docker compose run --rm backup restore <ficheiro>`), com confirmação obrigatória (`--yes`) porque **substitui** a base de dados atual.
- Os scripts são shell POSIX (`sh`), versionados em `scripts/backup/`, montados no contentor (sem criar mais uma imagem).

## 3. Decisões e limitações assumidas

| Decisão | Porquê |
|---|---|
| As cópias **não** incluem o `.env` | Contém os segredos; juntá-lo às cópias espalharia as chaves. O administrador deve guardar o `.env` à parte (cofre de passwords) — fica escrito no README |
| Cópias **não cifradas** | A cifra exigiria gerir uma chave, que é mais um segredo a perder. Documenta-se que a pasta contém dados pessoais e hashes de passwords e deve ter permissões restritas / estar num disco protegido |
| Cópia do MinIO **sem parar o serviço** | Os objetos são ficheiros imutáveis; no pior caso um anexo a meio de ser escrito fica de fora e volta na cópia seguinte. Aceitável para anexos |
| Uma cópia local **não é** uma cópia fora do local | Protege de erros e avarias de software, **não** de roubo/incêndio/falha total do servidor. Recomenda-se apontar `BACKUP_DIR` a outro disco/máquina; fica no README e nas limitações |
| Sem cópias incrementais / point-in-time | Complexidade desproporcionada para esta dimensão; a granularidade é diária |

## 4. Validação (o único teste que conta é restaurar)

Numa stack isolada (projeto `-p` à parte, segredos aleatórios, portas alternativas — como no plano Docker):
1. Subir, correr as migrações e criar dados reconhecíveis (utilizador + empresa) e um objeto no MinIO.
2. Esperar/forçar uma cópia e verificar os ficheiros e o `pg_restore --list`.
3. **Destruir** a base de dados (apagar os dados) e confirmar que desapareceram.
4. Restaurar com o script e confirmar que os dados **voltaram**, incluindo o login do utilizador.
5. Casos de falha: restauro sem `--yes` recusado; ficheiro inexistente/corrompido recusado **sem tocar na base atual**; retenção apaga as antigas mas guarda a mais recente.

## 5. Riscos

| Risco | Mitigação |
|---|---|
| O restauro apagar a base atual por engano | `--yes` obrigatório; validação do ficheiro com `pg_restore --list` **antes** de tocar na base; mensagem a dizer o que vai ser substituído |
| A pasta de cópias crescer sem fim | Retenção por dias; o tamanho de cada cópia é registado no log |
| O serviço de cópias falhar em silêncio | Falha de dump/verificação → o contentor regista erro e termina o ciclo com código ≠ 0 (visível em `docker compose ps`/logs); `restart: unless-stopped` volta a tentar no ciclo seguinte |

## 6. Fora de âmbito
Cópia fora do local (S3/rclone), cifra, alertas por email, cópias incrementais, interface no CRM para ver/restaurar cópias.

## 7. Registo de execução

- [ ] Scripts e serviço compose
- [ ] Restauro validado de ponta a ponta numa stack isolada
- [ ] Documentação (README + decisões)
- [ ] PR
