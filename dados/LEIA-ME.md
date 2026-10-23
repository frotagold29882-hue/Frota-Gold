# Pasta de dados — não apague

- `base.json` — base consolidada (abastecimentos, multas, frota e ajustes). É gravada pelo painel.
- `importacoes/AAAA-MM/` — cópia exata de cada planilha importada, com data e hora no nome.
- `.backups/` — últimas 30 versões da base neste computador (não vai para o git).

Cada gravação do painel gera um commit no git. Para ver ou recuperar uma versão antiga:

    git log --oneline -- dados/base.json
    git show <commit>:dados/base.json > base-recuperada.json
