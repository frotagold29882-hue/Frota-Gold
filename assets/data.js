/* Painel da Frota — leitura das planilhas, base consolidada e cálculos.
 * Regra principal: importar NUNCA apaga. Registros novos entram, os já existentes
 * são atualizados pela chave (nº da transação, nº da infração, placa). */
(function () {
  'use strict';

  const VERSAO = 1;
  const CACHE = 'painelFrota.v1';

  const UFS = {
    ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA', CEARA: 'CE', 'DISTRITO FEDERAL': 'DF',
    'ESPIRITO SANTO': 'ES', GOIAS: 'GO', MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
    'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR', PERNAMBUCO: 'PE', PIAUI: 'PI',
    'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO', RORAIMA: 'RR',
    'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE', TOCANTINS: 'TO'
  };
  const SIGLAS = new Set(Object.values(UFS));
  const NOMES_UF = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };

  // Locais de multa conhecidos (decididos com o usuário)
  const LOCAIS_PADRAO = [
    ['EST MUNICIPAL NATAL', 'RN'], ['ROD AUGUSTO MONTENEGRO', 'PA'], ['SPD 128/021', 'SP'],
    ['BELEM', 'PA'], ['SAO LUIS', 'MA'], ['CUIABA', 'MT']
  ];
  const LOCAL_ORGAO_BRASILIA = 'SAN QD 3 BL A';

  const SEM_UNIDADE = 'SEM UNIDADE';

  // Onde fica cada unidade no mapa (lat, lon). Unidades novas são posicionadas em Ajustes.
  const LOCAL_UNIDADES = {
    'LONDRINA': { lat: -23.31, lon: -51.16 }, 'MONTES CLAROS': { lat: -16.73, lon: -43.86 }, 'BELEM': { lat: -1.46, lon: -48.49 },
    'CAXIAS DO SUL': { lat: -29.17, lon: -51.18 }, 'DIADEMA': { lat: -23.69, lon: -46.62 }, 'CUIABA': { lat: -15.60, lon: -56.10 },
    'JOAO PESSOA': { lat: -7.12, lon: -34.86 }, 'SAO LUIS': { lat: -2.53, lon: -44.30 }, 'CAMPO GRANDE': { lat: -20.44, lon: -54.65 },
    'JOINVILLE': { lat: -26.30, lon: -48.85 }, 'RECIFE': { lat: -8.05, lon: -34.88 }
  };

  // ---------- utilidades ----------
  const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveTexto = s => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const normPlaca = s => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // placa brasileira: antiga (ABC1234) ou Mercosul (ABC1D23). Evita ler legendas/observações da planilha como veículo.
  const placaValida = p => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p);
  function normUnidade(s) {
    const u = chaveTexto(s);
    if (!u || u === 'NAO INFORMADA' || u === 'NAO INFORMADO' || u === '-') return SEM_UNIDADE;
    return u;
  }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).trim().replace(/R\$\s?/i, '');
    if (!s) return null;
    if (/,\d{1,3}$/.test(s) || /\.\d{3},/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  const pad = n => String(n).padStart(2, '0');
  const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function data(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return isoDe(v);
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) { let a = +m[3]; if (a < 100) a += 2000; return `${a}-${pad(+m[2])}-${pad(+m[1])}`; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  function hora(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') { const min = Math.round((v % 1) * 1440); return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
    return String(v).trim().slice(0, 5);
  }
  function ufDeTexto(s) {
    const t = chaveTexto(s);
    if (!t) return '';
    if (SIGLAS.has(t)) return t;
    if (UFS[t]) return UFS[t];
    return '';
  }

  // ---------- leitura das planilhas ----------
  function linhas(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }); }

  function acharCabecalho(rows, obrigatorias) {
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const cab = (rows[i] || []).map(chaveTexto);
      if (obrigatorias.every(o => cab.includes(o))) return { i, cab };
    }
    return null;
  }
  function col(cab, ...nomes) {
    for (const n of nomes) { const k = cab.indexOf(chaveTexto(n)); if (k >= 0) return k; }
    return -1;
  }
  const pega = (r, k) => (k >= 0 ? r[k] : null);

  function lerAbastecimentos(wb) {
    for (const nome of wb.SheetNames) {
      const rows = linhas(wb.Sheets[nome]);
      const h = acharCabecalho(rows, ['TRANSACAO', 'LITRAGEM', 'PLACA']);
      if (!h) continue;
      const c = h.cab, C = {
        id: col(c, 'Transacao'), data: col(c, 'Data da transacao'), hora: col(c, 'Hora da transacao'),
        posto: col(c, 'Estabelecimento'), estado: col(c, 'Estado'), cidade: col(c, 'Cidade'),
        operacao: col(c, 'Operacao'), placa: col(c, 'Placa'), modelo: col(c, 'Modelo'), motorista: col(c, 'Motorista'),
        hod: col(c, 'Hodometro/Horimetro'), km: col(c, 'Percorrido'), litros: col(c, 'Litragem'),
        comb: col(c, 'Combustivel'), preco: col(c, 'Preco'), valor: col(c, 'Valor total')
      };
      const out = [];
      for (const r of rows.slice(h.i + 1)) {
        const id = pega(r, C.id);
        if (id == null || id === '') continue;
        const comb = chaveTexto(pega(r, C.comb));
        out.push({
          id: String(id).trim(), data: data(pega(r, C.data)), hora: hora(pega(r, C.hora)),
          posto: String(pega(r, C.posto) ?? '').trim(), uf: ufDeTexto(pega(r, C.estado)) || chaveTexto(pega(r, C.estado)),
          cidade: chaveTexto(pega(r, C.cidade)), operacao: pega(r, C.operacao) ? normUnidade(pega(r, C.operacao)) : '',
          placa: normPlaca(pega(r, C.placa)), modelo: String(pega(r, C.modelo) ?? '').trim(),
          motorista: chaveTexto(pega(r, C.motorista)), hodometro: num(pega(r, C.hod)), km: num(pega(r, C.km)),
          litros: num(pega(r, C.litros)) || 0, combustivel: comb.includes('ARLA') ? 'ARLA' : comb.includes('DIESEL') ? 'DIESEL' : (comb || 'OUTRO'),
          combustivelNome: String(pega(r, C.comb) ?? '').trim(), preco: num(pega(r, C.preco)), valor: num(pega(r, C.valor)) || 0
        });
      }
      return out;
    }
    return null;
  }

  function lerMultas(wb) {
    const out = new Map(); // dentro do mesmo arquivo vale a primeira ocorrência
    let achou = false;
    // abas genéricas ("Planilha1" é cópia da aba do ano) ficam por último
    const abas = [...wb.SheetNames].sort((a, b) => /^PLANILHA/.test(chaveTexto(a)) - /^PLANILHA/.test(chaveTexto(b)));
    for (const nome of abas) {
      const rows = linhas(wb.Sheets[nome]);
      const h = acharCabecalho(rows, ['PLACA', 'VALOR', 'LOCAL']);
      if (!h || col(h.cab, 'TIPO INFRACAO', 'Nº INFRACAO', 'N INFRACAO') < 0) continue;
      achou = true;
      const c = h.cab, C = {
        data: col(c, 'DATA'), hora: col(c, 'HORA'), local: col(c, 'LOCAL'), tipo: col(c, 'TIPO INFRACAO'),
        numero: col(c, 'Nº INFRACAO', 'N INFRACAO', 'NO INFRACAO', 'NUMERO INFRACAO'), placa: col(c, 'PLACA'),
        motorista: col(c, 'MOTORISTA'), orgao: col(c, 'ORGAO'), valor: col(c, 'VALOR'), valorDesc: col(c, 'VALOR DESC'),
        venc: col(c, 'VENC'), fin: col(c, 'FINANCEIRO'), obs: col(c, 'OBSERVACAO')
      };
      const sic = chaveTexto(nome).includes('SIC');
      for (const r of rows.slice(h.i + 1)) {
        const placa = normPlaca(pega(r, C.placa));
        const dt = data(pega(r, C.data));
        const vCheio = num(pega(r, C.valor)), vDesc = num(pega(r, C.valorDesc));
        if (!placa && !dt) continue;
        if (vCheio == null && vDesc == null && !pega(r, C.tipo)) continue;
        const numero = normPlaca(pega(r, C.numero));
        const valor = vCheio != null ? vCheio : (vDesc != null ? vDesc : 0);
        const id = numero || `${dt}|${placa}|${valor}|${chaveTexto(pega(r, C.tipo)).slice(0, 40)}`;
        if (out.has(id)) continue;
        out.set(id, {
          id,
          numero, data: dt, hora: hora(pega(r, C.hora)), local: String(pega(r, C.local) ?? '').trim(),
          tipo: String(pega(r, C.tipo) ?? '').trim(), placa, motorista: chaveTexto(pega(r, C.motorista)),
          orgao: String(pega(r, C.orgao) ?? '').trim(), valor, valorDesc: vDesc, venc: data(pega(r, C.venc)),
          financeiro: String(pega(r, C.fin) ?? '').trim(), obs: String(pega(r, C.obs) ?? '').trim(),
          sic, aba: nome.trim()
        });
      }
    }
    return achou ? [...out.values()] : null;
  }

  function lerFrota(wb) {
    for (const nome of wb.SheetNames) {
      const rows = linhas(wb.Sheets[nome]);
      const h = acharCabecalho(rows, ['PLACA', 'UNIDADE / OPERACAO']);
      if (!h) continue;
      const c = h.cab, C = { placa: col(c, 'PLACA'), unidade: col(c, 'UNIDADE / OPERACAO'), situacao: col(c, 'SITUACAO'), modelo: col(c, 'MODELO'), tipo: col(c, 'TIPO') };
      const out = [];
      for (const r of rows.slice(h.i + 1)) {
        const placa = normPlaca(pega(r, C.placa));
        if (!placaValida(placa)) continue;
        out.push({ placa, unidade: normUnidade(pega(r, C.unidade)), situacao: String(pega(r, C.situacao) ?? '').trim(), modelo: String(pega(r, C.modelo) ?? '').trim(), tipo: String(pega(r, C.tipo) ?? '').trim() });
      }
      return out;
    }
    return null;
  }

  /** Lê um arquivo e devolve { tipo, registros } detectando pelo cabeçalho. */
  /** Fatura do TruckPag em CSV (";"): blocos "Transacao Aprovada" e "Transacao Estornada".
   *  A data vem sem ano (dd/mm); o ano sai da data de referência do arquivo. */
  function lerFaturaCSV(nome, texto) {
    const linhasTxt = texto.split(/\r?\n/);
    if (!linhasTxt.some(l => /^Transacao Aprovada;Data\/Hora;Placa;Hodometro/i.test(l))) return null;
    // data de referência: AAAA-MM-DD no nome do arquivo, ou alguma data completa dentro dele, ou hoje
    let ref = (nome.match(/(\d{4})-(\d{2})-(\d{2})/) || []).slice(1).join('-');
    if (!ref) { const m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/); ref = m ? `${m[3]}-${m[2]}-${m[1]}` : isoDe(new Date()); }
    const [anoRef, mesRef] = [+ref.slice(0, 4), +ref.slice(5, 7)];
    function dataHora(v) {
      const s = String(v || '').trim();
      let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}))?/);
      if (m) return [`${m[3]}-${pad(+m[2])}-${pad(+m[1])}`, m[4] || ''];
      m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/);
      if (!m) return [null, ''];
      const ano = +m[2] > mesRef ? anoRef - 1 : anoRef;
      return [`${ano}-${pad(+m[2])}-${pad(+m[1])}`, m[3] || ''];
    }
    const out = [];
    let bloco = null, C = null;
    for (const l of linhasTxt) {
      const c = l.split(';');
      if (/^Transacao (Aprovada|Estornada)$/i.test(c[0].trim())) {
        bloco = /Estornada/i.test(c[0]) ? 'estorno' : 'aprovada';
        const cab = c.map(chaveTexto);
        C = { data: cab.indexOf('DATA/HORA'), placa: cab.indexOf('PLACA'), hod: cab.indexOf('HODOMETRO'), mot: cab.indexOf('MOTORISTA'),
          posto: cab.indexOf('NOME ESTABELECIMENTO'), cidade: cab.indexOf('CIDADE'), uf: cab.indexOf('UF'), comb: cab.findIndex(x => x.startsWith('COMBUSTIVEL')),
          litros: cab.indexOf('LITRAGEM'), preco: cab.indexOf('VALOR UN.'), valor: cab.indexOf('VALOR TOTAL') };
        continue;
      }
      if (!bloco || !/^\d{5,}$/.test(c[0].trim())) { if (bloco && !c.join('').trim()) bloco = null; continue; }
      const [dt, hr] = dataHora(c[C.data]);
      const combTxt = chaveTexto(c[C.comb]);
      const est = bloco === 'estorno';
      const litros = Math.abs(num(c[C.litros]) || 0);
      out.push({
        id: c[0].trim(), data: dt, hora: hr, posto: String(c[C.posto] || '').trim(), uf: ufDeTexto(c[C.uf]) || chaveTexto(c[C.uf]),
        cidade: chaveTexto(c[C.cidade]), operacao: '', placa: normPlaca(c[C.placa]), modelo: '', motorista: chaveTexto(c[C.mot]),
        hodometro: num(c[C.hod]), km: null, litros: est ? -litros : litros,
        combustivel: combTxt.includes('ARLA') ? 'ARLA' : combTxt.includes('DIESEL') ? 'DIESEL' : (combTxt || 'OUTRO'),
        combustivelNome: String(c[C.comb] || '').trim() + (est ? ' (estorno)' : ''),
        preco: num(c[C.preco]) == null ? null : Math.abs(num(c[C.preco])), valor: est ? -Math.abs(num(c[C.valor]) || 0) : (num(c[C.valor]) || 0),
        estorno: est || undefined, origem: 'fatura TruckPag'
      });
    }
    return out.length ? out : null;
  }

  function ehConsolidadoPorPosto(wb) {
    for (const nome of wb.SheetNames) {
      const h = acharCabecalho(linhas(wb.Sheets[nome]), ['POSTO', 'TRANSACOES', 'LITRAGEM']);
      if (h && h.cab.includes('PRECO MEDIO') && !h.cab.includes('PLACA')) return true;
    }
    return false;
  }

  // ---------- relatórios MENSAIS do TruckPag (ficam à parte dos lançamentos, para não somar em dobro) ----------
  const MESES = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12 };
  /** Mês pelo nome do arquivo ("Consolidado Out.xlsx", "Média Outubro 2026.xlsx"). */
  function mesDoNome(nome) {
    const n = chaveTexto(nome);
    const m = n.match(/(?:^|[^A-Z])(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)[A-Z]*(?:[^A-Z]|$)/);
    if (!m) return '';
    const mes = MESES[m[1]];
    const anoNome = (n.match(/(20\d{2})/) || [])[1];
    const hoje = new Date();
    const ano = anoNome ? +anoNome : (mes > hoje.getMonth() + 1 ? hoje.getFullYear() - 1 : hoje.getFullYear());
    return `${ano}-${pad(mes)}`;
  }
  const pareceSemanal = nome => /\d{1,2}\s*(a|ate|-)\s*\d{1,2}/i.test(semAcento(nome)) && !/20\d{2}\s*-\s*\d{2}/.test(nome);

  function lerResumoPostos(nome, wb) {
    for (const aba of wb.SheetNames) {
      const rows = linhas(wb.Sheets[aba]);
      const h = acharCabecalho(rows, ['POSTO', 'TRANSACOES', 'LITRAGEM']);
      if (!h || !h.cab.includes('PRECO MEDIO') || h.cab.includes('PLACA')) continue;
      const c = h.cab, C = { posto: col(c, 'Posto'), cidade: col(c, 'Cidade'), uf: col(c, 'UF'), tr: col(c, 'Transacoes'), comb: col(c, 'Combustivel'),
        litros: col(c, 'Litragem'), valor: col(c, 'Valor'), preco: col(c, 'Preco medio'), dt: col(c, 'Data do ultimo preco transacionado', 'Dt do Abastecimento') };
      const out = [];
      for (const r of rows.slice(h.i + 1)) {
        const posto = String(pega(r, C.posto) ?? '').trim();
        if (!posto || /^TOTA/i.test(posto)) continue;
        const comb = chaveTexto(pega(r, C.comb));
        out.push({ posto, cidade: chaveTexto(pega(r, C.cidade)), uf: ufDeTexto(pega(r, C.uf)) || chaveTexto(pega(r, C.uf)), transacoes: num(pega(r, C.tr)) || 0,
          combustivel: comb.includes('ARLA') ? 'ARLA' : comb.includes('DIESEL') ? 'DIESEL' : (comb || 'OUTRO'), litros: num(pega(r, C.litros)) || 0,
          valor: num(pega(r, C.valor)) || 0, preco: num(pega(r, C.preco)), ultimaData: data(pega(r, C.dt)) });
      }
      const datas = out.map(o => o.ultimaData).filter(Boolean).sort();
      const dias = datas.length ? (new Date(datas.at(-1)) - new Date(datas[0])) / 864e5 : 0;
      if (pareceSemanal(nome) || dias < 15)
        throw new Error(`Este consolidado por posto parece ser de poucos dias (${datas.length ? dBRcurto(datas[0]) + ' a ' + dBRcurto(datas.at(-1)) : 'sem datas'}). O painel guarda só o consolidado do MÊS inteiro; para as semanas, use a fatura do TruckPag (CSV).`);
      const cont = {}; for (const d of datas) cont[d.slice(0, 7)] = (cont[d.slice(0, 7)] || 0) + 1;
      const mes = mesDoNome(nome) || Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
      return { mes, registros: out, periodo: [datas[0], datas.at(-1)] };
    }
    return null;
  }

  function lerResumoVeiculos(nome, wb) {
    for (const aba of wb.SheetNames) {
      const rows = linhas(wb.Sheets[aba]);
      const h = acharCabecalho(rows, ['PLACA', 'LITRAGEM', 'VALOR TOTAL']);
      if (!h || !(h.cab.includes('MEDIA') || h.cab.includes('CENTRO DE CUSTO'))) continue;
      const c = h.cab, C = { placa: col(c, 'Placa'), frota: col(c, 'Numero da frota'), centro: col(c, 'Centro de custo'), marca: col(c, 'Marca'), modelo: col(c, 'Modelo'),
        km: col(c, 'Ultimo KM'), litros: col(c, 'Litragem'), media: col(c, 'Media'), valor: col(c, 'Valor Total') };
      const out = [];
      for (const r of rows.slice(h.i + 1)) {
        const placa = normPlaca(pega(r, C.placa));
        if (!placaValida(placa)) continue;
        const centro = String(pega(r, C.centro) ?? '').trim();
        const media = num(pega(r, C.media));
        out.push({ placa, frota: String(pega(r, C.frota) ?? '').trim(), unidade: /^null$/i.test(centro) || !centro ? '' : normUnidade(centro),
          marca: String(pega(r, C.marca) ?? '').trim(), modelo: String(pega(r, C.modelo) ?? '').trim(), ultimoKm: num(pega(r, C.km)),
          litros: num(pega(r, C.litros)) || 0, media: media > 0 && media < 15 ? media : null, mediaInformada: media, valor: num(pega(r, C.valor)) || 0 });
      }
      const mes = mesDoNome(nome);
      if (!mes) throw new Error('Não consegui saber o mês deste relatório de médias. Coloque o mês no nome do arquivo (ex.: "Média Out.xlsx").');
      return { mes, registros: out };
    }
    return null;
  }
  const dBRcurto = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';

  /** PDF "Detalhes da Infração" (consulta de infrações do governo federal). O PDF precisa ter texto, não imagem. */
  async function lerMultaPDF(nome, buffer) {
    if (!window.pdfjsLib) throw new Error('Leitor de PDF não carregou (sem internet?).');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    let texto = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const c = await (await pdf.getPage(p)).getTextContent();
      const linhasPdf = {};
      for (const it of c.items) { const y = Math.round(it.transform[5]); (linhasPdf[y] = linhasPdf[y] || []).push([it.transform[4], it.str]); }
      texto += Object.keys(linhasPdf).sort((a, b) => b - a).map(y => linhasPdf[y].sort((a, b) => a[0] - b[0]).map(x => x[1]).join(' ')).join('\n') + '\n';
    }
    // junta pedaços quebrados pela ligadura "fi" (ex.: "Noti fi cação")
    const t = texto.replace(/[-]/g, '').replace(/[ \t]+/g, ' ').replace(/\s*fi\s*(?=ca[çc][ãa]o)/gi, 'fi');
    if (!/N[úu]mero do Auto de Infra[çc][ãa]o/i.test(t)) {
      if (!t.trim()) throw new Error('O PDF não tem texto (parece imagem escaneada). Lance essa multa na planilha de multas.');
      throw new Error('PDF não reconhecido. O painel lê o PDF "Detalhes da Infração".');
    }
    const pega1 = re => { const m = t.match(re); return m ? m[1].trim() : ''; };
    const numero = normPlaca(pega1(/N[úu]mero do Auto de Infra[çc][ãa]o\s+([A-Z0-9]+)/i));
    const dh = t.match(/Cometimento da Infra[çc][ãa]o\s+(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{1,2}:\d{2}))?/i) || [];
    const valor = num(pega1(/Valor Original\s+R\$\s*([\d.,]+)/i));
    const desc = (t.match(/Detalhes da Infra[çc][ãa]o\s*\n\s*([^\n]+)/i) || [])[1] || '';
    const codigo = pega1(/C[óo]digo da Infra[çc][ãa]o\s+([\d\s-]+?)\s*(?:\n|$)/i);
    const registro = {
      id: numero || `${data(dh[1])}|${normPlaca(pega1(/Placa[^:]*:\s*([A-Z0-9-]+)/i))}|${valor}`,
      numero, data: data(dh[1]), hora: dh[2] || '',
      local: pega1(/Local da Infra[çc][ãa]o\s+([^\n]+)/i),
      tipo: (desc.trim() + (codigo ? ` (cód. ${codigo.replace(/\s+/g, '')})` : '')).trim(),
      placa: normPlaca(pega1(/Placa[^:\n]*:\s*([A-Z0-9-]+)/i)), motorista: '',
      orgao: pega1(/[ÓO]rg[ãa]o Autuador\s+([^\n]+)/i),
      valor: valor || 0, valorDesc: null,
      venc: null, financeiro: '', obs: `RENAINF ${pega1(/RENAINF\s+(\d+)/i)}`.trim(),
      prazoDefesa: data(pega1(/Interposi[çc][ãa]o de Defesa\s+(\d{2}\/\d{2}\/\d{4})/i)),
      prazoCondutor: data(pega1(/Identifica[çc][ãa]o do\s+(\d{2}\/\d{2}\/\d{4})/i)),
      notificacao: data(pega1(/Data da Notifica[çc][ãa]o de Autua[çc][ãa]o\s+(\d{2}\/\d{2}\/\d{4})/i)),
      sic: false, aba: 'PDF da infração'
    };
    if (!registro.placa || !registro.data) throw new Error('Não encontrei placa ou data da infração no PDF.');
    return [registro];
  }

  function lerArquivo(nome, buffer) {
    if (/\.pdf$/i.test(nome)) return lerMultaPDF(nome, buffer).then(r => ({ tipo: 'multas', registros: r, formato: 'Multa (PDF da infração)' }));
    if (/\.(csv|txt)$/i.test(nome)) {
      let texto = new TextDecoder('utf-8').decode(buffer);
      if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buffer);
      const f = lerFaturaCSV(nome, texto);
      if (f) return { tipo: 'abastecimentos', registros: f, formato: 'Fatura TruckPag (CSV)' };
    }
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
    let r;
    if ((r = lerAbastecimentos(wb))) return { tipo: 'abastecimentos', registros: r, formato: 'Listagem de abastecimentos' };
    if ((r = lerMultas(wb))) return { tipo: 'multas', registros: r, formato: 'Multas' };
    if ((r = lerFrota(wb))) return { tipo: 'frota', registros: r, formato: 'Cadastro da frota' };
    if ((r = lerResumoVeiculos(nome, wb))) return { tipo: 'resumoVeiculos', mes: r.mes, registros: r.registros, formato: `Média por veículo do mês (${r.mes.slice(5)}/${r.mes.slice(0, 4)})` };
    if ((r = lerResumoPostos(nome, wb))) return { tipo: 'resumoPostos', mes: r.mes, periodo: r.periodo, registros: r.registros, formato: `Consolidado por posto do mês (${r.mes.slice(5)}/${r.mes.slice(0, 4)})` };
    throw new Error(`Não reconheci o arquivo "${nome}". Esperado: fatura do TruckPag (CSV), listagem de abastecimentos, planilha de multas ou cadastro da frota.`);
  }

  // ---------- base consolidada ----------
  function baseVazia() {
    return {
      resumo: { total_abastecimentos: 0, total_multas: 0, total_frota: 0, atualizado: null },
      versao: VERSAO,
      abastecimentos: [], multas: [], frota: [],
      ajustes: { kmMax: 3000, unidadePorPlaca: {}, ufPorMulta: {}, localUF: {}, localUnidade: {} },
      importacoes: [],
      resumos: { postos: {}, veiculos: {} } // relatórios mensais do TruckPag, por mês (AAAA-MM)
    };
  }

  function garantir(b) {
    const v = baseVazia();
    if (!b || typeof b !== 'object' || b.vazio) return v;
    for (const k of Object.keys(v)) if (b[k] == null) b[k] = v[k];
    b.ajustes = Object.assign(v.ajustes, b.ajustes);
    return b;
  }

  function atualizarResumo(b) {
    b.resumo = { total_abastecimentos: b.abastecimentos.length, total_multas: b.multas.length, total_frota: b.frota.length, atualizado: new Date().toISOString() };
    return b;
  }

  /** Junta registros novos sem nunca remover os existentes. */
  function mesclar(base, tipo, registros) {
    const chave = tipo === 'frota' ? 'placa' : 'id';
    const mapa = new Map(base[tipo].map(r => [r[chave], r]));
    let novos = 0, atualizados = 0;
    for (const r of registros) {
      const k = r[chave];
      if (!k) continue;
      const ant = mapa.get(k);
      if (!ant) { mapa.set(k, r); novos++; }
      else {
        const junto = Object.assign({}, ant);
        for (const [c, v] of Object.entries(r)) if (v !== null && v !== '' && v !== undefined) junto[c] = v;
        if (JSON.stringify(junto) !== JSON.stringify(ant)) { mapa.set(k, junto); atualizados++; }
      }
    }
    base[tipo] = [...mapa.values()];
    if (tipo !== 'frota') base[tipo].sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.id).localeCompare(String(b.id)));
    else base[tipo].sort((a, b) => a.placa.localeCompare(b.placa));
    return { novos, atualizados, iguais: registros.length - novos - atualizados };
  }

  // ---------- regras de negócio ----------
  function contexto(base) {
    const frota = new Map(base.frota.filter(f => placaValida(f.placa)).map(f => [f.placa, f]));
    const aj = base.ajustes;
    // centro de custo dos relatórios mensais de média: só vale quando a placa não tem unidade no ajuste nem no cadastro
    const centroCusto = new Map();
    for (const mes of Object.keys(base.resumos?.veiculos || {}).sort()) for (const v of base.resumos.veiculos[mes].linhas || []) if (v.unidade) centroCusto.set(v.placa, v.unidade);
    const unidadePlaca = p => {
      const doCadastro = normUnidade(aj.unidadePorPlaca[p] || frota.get(p)?.unidade || '');
      return doCadastro !== SEM_UNIDADE ? doCadastro : normUnidade(centroCusto.get(p) || '');
    };
    const locais = [...Object.entries(aj.localUF || {}).map(([t, u]) => [chaveTexto(t), u]), ...LOCAIS_PADRAO];

    function ufMulta(m) {
      if (aj.ufPorMulta[m.id]) return aj.ufPorMulta[m.id];
      const l = chaveTexto(m.local);
      if (!l) return 'N/I';
      if (l.includes(LOCAL_ORGAO_BRASILIA)) return 'N/I';
      for (const [t, u] of locais) if (t && l.includes(t)) return u;
      for (const [n, s] of Object.entries(UFS).sort((a, b) => b[0].length - a[0].length)) if (new RegExp(`(^|[^A-Z])${n}([^A-Z]|$)`).test(l)) return s;
      if (SIGLAS.has(l)) return l;
      let mm = l.match(/[\s\-\/]([A-Z]{2})$/); if (mm && SIGLAS.has(mm[1])) return mm[1];
      mm = l.match(/^([A-Z]{2})[\s\-\/]/); if (mm && SIGLAS.has(mm[1])) return mm[1];
      return 'N/I';
    }

    const kmMax = Number(aj.kmMax) || 3000;
    // Km percorrido: usa o "Percorrido" do relatório; se não vier (fatura CSV), calcula pelo hodômetro
    // = hodômetro atual − maior hodômetro anterior da mesma placa.
    const porPlacaHod = new Map();
    for (const a of base.abastecimentos) if (a.hodometro > 0 && !a.estorno) { if (!porPlacaHod.has(a.placa)) porPlacaHod.set(a.placa, []); porPlacaHod.get(a.placa).push(a); }
    for (const l of porPlacaHod.values()) l.sort((x, y) => String(x.data).localeCompare(String(y.data)) || x.hodometro - y.hodometro);
    function kmPeloHodometro(a) {
      const l = porPlacaHod.get(a.placa); if (!l) return null;
      let ant = null;
      for (const b of l) {
        if (b === a || String(b.data) > String(a.data)) break;
        if (b.data === a.data && b.posto === a.posto) continue; // mesma parada (ex.: Arla e diesel juntos)
        if (b.hodometro < a.hodometro && (ant == null || b.hodometro > ant)) ant = b.hodometro;
      }
      return ant == null ? null : a.hodometro - ant;
    }
    const abast = base.abastecimentos.map(a => {
      const unidade = a.operacao && a.operacao !== SEM_UNIDADE ? a.operacao : unidadePlaca(a.placa);
      const km = a.km != null ? a.km : (a.estorno || !(a.hodometro > 0) ? null : kmPeloHodometro(a));
      const kmValido = !a.estorno && a.combustivel === 'DIESEL' && km > 0 && km <= kmMax;
      return Object.assign({}, a, { unidade, km, kmValido });
    });
    // Duplicidade: mesmo nº de infração conta 1 vez (a chave da base já garante)
    const multas = base.multas.map(m => Object.assign({}, m, { unidade: unidadePlaca(m.placa), ufCalc: ufMulta(m), noCadastro: frota.has(m.placa) }));
    return { abast, multas, frota, unidadePlaca, kmMax };
  }

  function filtrar(ctx, f) {
    const dentro = d => d && (!f.de || d >= f.de) && (!f.ate || d <= f.ate);
    const ab = ctx.abast.filter(a => dentro(a.data) && (!f.unidade || a.unidade === f.unidade) && (!f.uf || a.uf === f.uf));
    const mu = ctx.multas.filter(m => dentro(m.data) && (!f.unidade || m.unidade === f.unidade) && (!f.uf || m.ufCalc === f.uf));
    return { ab, mu };
  }

  function soma(arr, fn) { let s = 0; for (const x of arr) s += fn(x) || 0; return s; }
  function agrupar(arr, chaveFn) { const m = new Map(); for (const x of arr) { const k = chaveFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }

  function indicadores(ab, mu) {
    const diesel = ab.filter(a => a.combustivel === 'DIESEL');
    const arla = ab.filter(a => a.combustivel === 'ARLA');
    const validos = diesel.filter(a => a.kmValido);
    const custoDiesel = soma(diesel, a => a.valor);
    const custoArla = soma(arla, a => a.valor);
    const outros = soma(ab.filter(a => a.combustivel !== 'DIESEL' && a.combustivel !== 'ARLA'), a => a.valor);
    const litrosDiesel = soma(diesel, a => a.litros);
    const litrosArla = soma(arla, a => a.litros);
    const km = soma(validos, a => a.km);
    const valorValidos = soma(validos, a => a.valor);
    const litrosValidos = soma(validos, a => a.litros);
    const custoMultas = soma(mu, m => m.valor);
    return {
      custoTotal: custoDiesel + custoArla + outros + custoMultas,
      custoDiesel, custoArla, custoOutros: outros, custoMultas, qtdMultas: mu.length,
      litrosDiesel, litrosArla, km, qtdAbast: ab.filter(a => !a.estorno).length, qtdDiesel: diesel.filter(a => !a.estorno).length,
      qtdKmInvalido: diesel.filter(a => !a.estorno).length - validos.length,
      rsKm: km ? valorValidos / km : null,
      kmL: litrosValidos ? km / litrosValidos : null,
      rsLitro: litrosDiesel ? custoDiesel / litrosDiesel : null,
      arlaPct: litrosDiesel ? litrosArla / litrosDiesel : null,
      veiculos: new Set(ab.map(a => a.placa)).size
    };
  }

  function porUnidade(ab, mu) {
    const unidades = new Set([...ab.map(a => a.unidade), ...mu.map(m => m.unidade)]);
    const gA = agrupar(ab, a => a.unidade), gM = agrupar(mu, m => m.unidade);
    return [...unidades].map(u => Object.assign({ unidade: u }, indicadores(gA.get(u) || [], gM.get(u) || [])));
  }

  /** Curva ABC: A até 80% do custo acumulado, B até 95%, C o restante. */
  function curvaABC(itens, valorFn) {
    const lista = itens.map(i => ({ item: i, valor: valorFn(i) || 0 })).filter(x => x.valor > 0).sort((a, b) => b.valor - a.valor);
    const total = soma(lista, x => x.valor);
    let acc = 0;
    return lista.map(x => {
      const antes = acc; acc += x.valor;
      const classe = total === 0 ? 'C' : antes / total < 0.8 ? 'A' : antes / total < 0.95 ? 'B' : 'C';
      return Object.assign({}, x.item, { valorABC: x.valor, pct: total ? x.valor / total : 0, acumulado: total ? acc / total : 0, classe });
    });
  }

  function porPlaca(ab, mu, ctx) {
    const gA = agrupar(ab, a => a.placa), gM = agrupar(mu, m => m.placa);
    const placas = new Set([...gA.keys(), ...gM.keys()]);
    return [...placas].map(p => {
      const lista = gA.get(p) || [];
      return Object.assign({ placa: p, unidade: ctx.unidadePlaca(p) !== SEM_UNIDADE ? ctx.unidadePlaca(p) : (lista.find(a => a.unidade)?.unidade || SEM_UNIDADE), modelo: lista[0]?.modelo || ctx.frota.get(p)?.modelo || '' }, indicadores(lista, gM.get(p) || []));
    });
  }

  function semanaISO(iso) {
    const d = new Date(iso + 'T12:00:00');
    const dia = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dia);
    return isoDe(d);
  }

  function evolucao(ab, mu) {
    const datas = [...ab.map(a => a.data), ...mu.map(m => m.data)].filter(Boolean).sort();
    if (!datas.length) return { chaves: [], diesel: [], arla: [], multas: [], mensal: false };
    const semanas = new Set(datas.map(semanaISO));
    const mensal = semanas.size > 26;
    const k = d => (mensal ? d.slice(0, 7) : semanaISO(d));
    const chaves = [...new Set(datas.map(k))].sort();
    const s = (arr, filtro) => { const m = new Map(chaves.map(c => [c, 0])); for (const x of arr) if (x.data && filtro(x)) m.set(k(x.data), m.get(k(x.data)) + x.valor); return [...m.values()]; };
    return {
      chaves, mensal,
      diesel: s(ab, a => a.combustivel === 'DIESEL'),
      arla: s(ab, a => a.combustivel !== 'DIESEL'),
      multas: s(mu, () => true)
    };
  }

  function pontosAtencao(ctx, ab, mu) {
    const kmInv = ab.filter(a => a.combustivel === 'DIESEL' && !a.kmValido && !a.estorno);
    const multasSemUF = mu.filter(m => m.ufCalc === 'N/I');
    const placasSemUnidade = new Map();
    for (const x of [...ab, ...mu]) if (x.unidade === SEM_UNIDADE && x.placa) placasSemUnidade.set(x.placa, (placasSemUnidade.get(x.placa) || 0) + 1);
    const forasCadastro = new Set(mu.filter(m => !m.noCadastro && m.placa).map(m => m.placa));
    const precos = ab.filter(a => a.combustivel === 'DIESEL' && a.preco && !a.estorno);
    const media = precos.length ? soma(precos, a => a.preco) / precos.length : 0;
    const precoAlto = precos.filter(a => a.preco > media * 1.15);
    // prazos de multas (de todas, não só do período): defesa prévia e identificação do condutor
    const hoje = isoDe(new Date()), em10 = isoDe(new Date(Date.now() + 10 * 864e5)), ha30 = isoDe(new Date(Date.now() - 30 * 864e5));
    const prazos = [];
    for (const m of ctx.multas) for (const [campo, nomePrazo] of [['prazoCondutor', 'Identificar o condutor'], ['prazoDefesa', 'Defesa prévia']]) {
      const d = m[campo]; if (!d || d < ha30 || d > em10) continue;
      prazos.push({ multa: m, prazo: d, oQue: nomePrazo, vencido: d < hoje, hoje: d === hoje });
    }
    prazos.sort((a, b) => a.prazo.localeCompare(b.prazo));
    return { kmInv, multasSemUF, placasSemUnidade, forasCadastro, precoAlto, mediaPreco: media, prazos };
  }

  // ---------- persistência ----------
  async function carregar() {
    if (window.BASE_EMBUTIDA) return { base: garantir(window.BASE_EMBUTIDA), origem: 'embutida' }; // arquivo de visualização
    try {
      const r = await fetch('api/base', { cache: 'no-store' });
      if (r.ok) { const b = garantir(await r.json()); salvarCache(b); return { base: b, origem: 'servidor' }; }
    } catch (e) { /* sem servidor */ }
    try { const c = localStorage.getItem(CACHE); if (c) return { base: garantir(JSON.parse(c)), origem: 'cache' }; } catch (e) {}
    return { base: baseVazia(), origem: 'vazio' };
  }
  function salvarCache(b) { try { localStorage.setItem(CACHE, JSON.stringify(b)); } catch (e) {} }

  async function guardarArquivo(nome, buffer) {
    const r = await fetch('api/arquivo?nome=' + encodeURIComponent(nome), { method: 'POST', body: buffer });
    if (!r.ok) throw new Error('Não consegui guardar a planilha original: ' + (await r.text()));
    return (await r.json()).arquivo;
  }

  async function gravar(base, mensagem) {
    atualizarResumo(base);
    salvarCache(base);
    // "resumo" vai primeiro para o servidor conferir as contagens
    const texto = JSON.stringify(base, null, 1);
    const r = await fetch('api/base?msg=' + encodeURIComponent(mensagem || 'Atualiza dados'), { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: texto });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha ao gravar no servidor');
    return j;
  }

  async function statusGit() { try { const r = await fetch('api/status', { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } }

  window.Dados = {
    SEM_UNIDADE, LOCAL_UNIDADES, placaValida, UFS, NOMES_UF, SIGLAS: [...SIGLAS].sort(),
    lerArquivo, baseVazia, garantir, mesclar, atualizarResumo,
    contexto, filtrar, indicadores, porUnidade, porPlaca, curvaABC, evolucao, pontosAtencao, agrupar, soma,
    carregar, gravar, guardarArquivo, statusGit, salvarCache, normPlaca, normUnidade, isoDe
  };
})();
