-- Utilizadores desativados deixam de poder entrar mas mantêm o histórico. Os existentes ficam ativos.
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
