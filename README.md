# Gold Frota — painel da frota

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

- **Mapa das unidades:** estados pintados pelo gasto com combustível e bolhas nas cidades das unidades, do tamanho do custo. Tocar num estado ou numa unidade filtra o painel. Unidades sem local (como a matriz, Carga Geral) são posicionadas em Ajustes, clicando no mapa.
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

## Aba Mês (relatórios mensais do TruckPag)

- Importe o **Consolidado do mês** (por posto) e a **Média do mês** (por veículo). Coloque o mês no nome do arquivo (ex.: "Consolidado Out.xlsx").
- Eles ficam guardados à parte, um por mês, sem somar com os lançamentos (para não contar em dobro). Importar de novo o mesmo mês substitui; a versão anterior fica no git.
- A aba mostra os maiores gastos por veículo, unidade, posto e estado, o diesel mais caro por posto e uma conferência entre os relatórios e os lançamentos do painel (com os dias que faltam).
- O centro de custo da Média também dá unidade às placas que não estão no cadastro.
- Consolidado por posto de poucos dias (semanal) é recusado: para semanas, use a fatura (CSV).

## Apresentação semanal e TV

- Aba **Apresentação**: 6 telas da semana (segunda a domingo) comparadas com a semana anterior: resumo, mapa, eficiência por unidade, postos e preços, veículos e motoristas, pontos de atenção.
- **Apresentar em tela cheia** para espelhar na TV. Setas do teclado (ou clique) passam as telas.
- **Gerar PDF**: abre a impressão do navegador. Escolha "Salvar como PDF" para ter uma página por tela.
- No Painel, o botão de tela cheia (no topo) aumenta as letras para mostrar na TV, e o período **Semana** tem setas para voltar semanas.

## Quem pode alterar

- **Só o computador onde roda o `Abrir Painel.bat` altera dados** (importar, ajustes, correções). O servidor recusa qualquer alteração vinda de outro lugar.
- **Arquivo para enviar** (aba Apresentação): gera um `.html` único, somente visualização, com os dados do momento. Quem abrir vê o painel, filtra, usa o mapa e a apresentação, mas não altera nada.
- **Acesso pela rede (opcional):** rode uma vez `Liberar na rede.bat` como administrador. Depois, a janela do painel mostra o endereço para os colegas (ex.: `http://192.168.0.10:8765/`), que abrem em modo somente visualização enquanto o seu computador estiver com o painel aberto.

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
