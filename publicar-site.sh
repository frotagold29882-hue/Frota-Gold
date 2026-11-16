#!/usr/bin/env bash
# Monta a pasta "site" que a Cloudflare publica: só o painel e a base consolidada.
# Planilhas originais, servidor e histórico NÃO vão para o site.
set -euo pipefail
rm -rf site
mkdir -p site/assets site/dados
cp index.html site/
cp assets/*.js assets/*.css site/assets/
if [ -f dados/base.json ]; then cp dados/base.json site/dados/base.json; else echo '{"vazio":true}' > site/dados/base.json; fi
cat > site/_headers <<'H'
/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  X-Frame-Options: DENY
H
echo "Site montado:"; find site -type f | sort
