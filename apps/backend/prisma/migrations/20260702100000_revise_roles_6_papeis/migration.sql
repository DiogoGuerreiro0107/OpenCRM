-- Revisao dos papeis (roles) de utilizador: 3 -> 6 papeis, conforme CLAUDE.md.
-- Mapeamento de dados existentes (em vez de um cast cego, que falharia para
-- valores antigos sem correspondencia direta no novo enum):
--   ADMIN     -> ADMINISTRADOR
--   GESTOR    -> BACKOFFICE
--   COMERCIAL -> COMERCIAL (inalterado)

BEGIN;

CREATE TYPE "Role_new" AS ENUM ('ADMINISTRADOR', 'COMERCIAL', 'TECNICO', 'BACKOFFICE', 'FINANCEIRO', 'LEITURA_APENAS');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING (
  CASE "role"::text
    WHEN 'ADMIN' THEN 'ADMINISTRADOR'
    WHEN 'GESTOR' THEN 'BACKOFFICE'
    WHEN 'COMERCIAL' THEN 'COMERCIAL'
    ELSE 'COMERCIAL'
  END
)::"Role_new";

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'COMERCIAL';

DROP TYPE "Role";

ALTER TYPE "Role_new" RENAME TO "Role";

COMMIT;
