# Painel da Frota

Painel de custos da frota (diesel, Arla e multas), com separação por unidade e por estado e com a curva ABC dos veículos.
Os dados ficam guardados **dentro deste repositório git**: cada importação vira uma versão e nada é apagado.

> ⚠️ O repositório contém nomes de motoristas, placas e multas. **Mantenha-o PRIVADO no GitHub.**

## Como usar

1. Dê dois cliques em **`Abrir Painel.bat`**. Abre uma janela preta (o servidor) e o painel no navegador.
   Deixe a janela aberta enquanto usa o painel.
2. Na aba **Importar**, arraste as planilhas da semana:
   - `listagem-abastecimentos.xlsx` (cartão combustível);
   - `Multas.xlsx`;
   - `Informações dos carros - Completa.xlsx` (cadastro da frota).

   O tipo de cada uma é reconhecido pelo cabeçalho, não pelo nome do arquivo.
3. Pronto. O painel se atualiza, e o selo no topo mostra se os dados foram salvos e enviados ao GitHub.

O painel precisa de internet para carregar os gráficos e o leitor de planilhas.

## Por que os dados não se perdem

| Camada | O que faz |
|---|---|
| **Junta, não substitui** | Importar só **adiciona** registros novos ou **atualiza** os existentes (pelo nº da transação, nº da infração ou placa). Nada sai da base. Exportações de 30 dias se acumulam em um histórico contínuo. |
| **Trava no servidor** | O servidor recusa qualquer gravação que deixe a base com **menos** abastecimentos, multas ou veículos do que antes. |
| **Planilha original guardada** | Cada arquivo importado é copiado, do jeito que veio, para `dados/importacoes/AAAA-MM/`. |
| **Commit automático** | Cada importação ou ajuste vira um commit no git, com data e hora. |
| **Envio ao GitHub** | Se o GitHub estiver conectado, cada commit também é enviado (push). Assim existe cópia fora do computador. |
| **Cópias locais** | As últimas 30 versões da base ficam em `dados/.backups/` (só neste computador). |

### Recuperar uma versão antiga

```bash
git log --oneline -- dados/base.json
git show <codigo-do-commit>:dados/base.json > base-recuperada.json
```

## Conectar ao GitHub (uma vez só)

1. Em https://github.com/new, crie um repositório **Private** e **vazio** (sem README).
2. Dê dois cliques em **`Conectar ao GitHub.bat`** e cole a URL do repositório.
3. Faça login quando o Git pedir. A partir daí, cada gravação do painel também é enviada.

## O que o painel mostra

O painel funciona como um Power BI:

- **Seleção cruzada:** clicar numa fatia, barra, linha de tabela ou motorista filtra **todos** os outros gráficos. O gráfico de onde veio o clique destaca o item escolhido e apaga os demais.
- **Ctrl + clique** seleciona vários itens. Clicar de novo no mesmo item desfaz. **Esc** limpa tudo.
- **Filtros laterais (segmentações):** período, tipo de custo, unidade, estado, classe ABC, placa e motorista, com busca. No celular, eles abrem pelo botão "Filtros".
- **Detalhamento:** clicar num veículo ou motorista mostra os lançamentos por trás dos números, na tabela "Detalhe dos lançamentos". A aba Dados também respeita as seleções e exporta para Excel.

Visuais:

- **Indicadores:**
  - custo total, diesel, multas, R$/km, km/L e preço do litro;
  - setas comparando com o período anterior, quando há dados para comparar.
- **Gráficos de rosca:**
  - para onde vai o dinheiro;
  - custo por unidade;
  - combustível por estado;
  - curva ABC dos veículos;
  - multas por unidade;
  - qualidade do hodômetro.
- **Ranking por unidade:** em verde, o que está melhor que a média da frota; em vermelho, o que está pior.
- **Evolução semanal:** vira mensal acima de 26 semanas. Clicar numa barra filtra aquela semana.
- **Motoristas que mais gastam:** combustível + multas, top 10.
- **Veículos:** lista completa pela curva ABC.
- **Pontos de atenção**, com correção ali mesmo: placas sem unidade, multas sem estado, hodômetro inválido e diesel caro.
- **Dados:** tabelas com busca e exportação para Excel (CSV).

## Regras de cálculo

- **Km válido:** só diesel, com km percorrido > 0 e ≤ 3.000 km (ajustável em Ajustes).
- **R$/km:** valor dos abastecimentos com km válido ÷ km válidos.
- **km/L:** km válidos ÷ litros desses mesmos abastecimentos.
- **R$/litro:** custo do diesel ÷ litros de diesel. O Arla fica separado.
- **Unidade do abastecimento:** coluna Operacao. Se ela vier vazia, vale a unidade da placa: primeiro o ajuste manual, depois o cadastro da frota.
- **Unidade da multa:** pela placa. Sem cadastro, a multa fica como "SEM UNIDADE".
- **Valor da multa:** coluna VALOR (valor cheio), pela data da infração. Se VALOR não for número, usa VALOR DESC.
- **Duplicidade de multas:** o mesmo Nº da infração conta uma vez só. A aba "Planilha1" é lida por último, porque é cópia da aba do ano.
- **UF da multa**, lida do LOCAL nesta ordem:
  1. ajuste manual;
  2. locais conhecidos;
  3. nome do estado;
  4. sigla.

  O endereço do órgão em Brasília ("SAN QD 3 BL A…") fica como N/I.
- **Curva ABC:** veículos ordenados pelo gasto com diesel.
  - A: até 80% do acumulado;
  - B: até 95%;
  - C: o restante.

## Estrutura

```
Abrir Painel.bat          inicia o servidor e abre o painel
Conectar ao GitHub.bat    liga o repositório ao GitHub (uma vez)
index.html, assets/       o painel (HTML, CSS, JS; Chart.js e SheetJS via CDN)
servidor/servidor.ps1     servidor local em PowerShell: grava dados e faz commit/push
dados/base.json           base consolidada (vai para o git)
dados/importacoes/        planilhas originais importadas (vão para o git)
```
