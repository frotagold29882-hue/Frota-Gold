/* Painel da Frota — interface
 * Modo "Power BI": cada visual filtra todos os outros (seleção cruzada).
 * - clique = seleciona só aquele item (clicar de novo desfaz)
 * - Ctrl/Shift + clique = soma ou tira itens da seleção
 * - o visual de onde veio a seleção não se filtra: ele destaca o item e apaga os demais */
(function () {
  'use strict';
  const D = window.Dados;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const st = {
    base: D.baseVazia(), ctx: null, servidor: false,
    filtro: { p: '30', de: '', ate: '' },
    sel: { custo: new Set(), unidade: new Set(), uf: new Set(), classe: new Set(), placa: new Set(), motorista: new Set(), periodo: new Set() },
    buscaSlicer: {}, slicerTodos: {},
    graficos: {}, coresUnidade: new Map(), dadosAba: 'abastecimentos', lancAba: 'ab',
    ordem: { col: 'custoTotal', dir: -1 }, mensal: false
  };

  // ---------- formatação ----------
  const fBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const fBRL3 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const fNum = (n, d = 0) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const brl = n => (n == null || !isFinite(n) ? '—' : fBRL.format(n));
  function brlCurto(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return 'R$ ' + fNum(n / 1e6, 2) + ' mi';
    if (a >= 1e4) return 'R$ ' + fNum(n / 1e3, 1) + ' mil';
    return brl(n);
  }
  const pct = (n, d = 0) => (n == null || !isFinite(n) ? '—' : fNum(n * 100, d) + '%');
  const dBR = iso => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
  function apagar(hex) { // cor do item não selecionado
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},0.22)`;
  }

  function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('mostra'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('mostra'), ms); }

  // ---------- período ----------
  function ultimaData() {
    let m = '';
    for (const a of st.base.abastecimentos) if (a.data > m) m = a.data;
    if (!m) for (const x of st.base.multas) if (x.data > m) m = x.data;
    return m || D.isoDe(new Date());
  }
  const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return D.isoDe(d); };
  const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
  function semanaDe(iso) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return D.isoDe(d); }

  function intervalo() {
    const f = st.filtro, fim = ultimaData();
    if (f.p === '7') return { de: addDias(fim, -6), ate: fim };
    if (f.p === '30') return { de: addDias(fim, -29), ate: fim };
    if (f.p === 'mes') return { de: fim.slice(0, 8) + '01', ate: fim };
    if (f.p === 'ano') return { de: fim.slice(0, 4) + '-01-01', ate: fim };
    if (f.p === 'livre') return { de: f.de, ate: f.ate };
    return { de: '', ate: '' };
  }
  function intervaloAnterior(iv) {
    if (!iv.de || !iv.ate || st.filtro.p === 'tudo') return null;
    const n = diasEntre(iv.de, iv.ate) + 1;
    const ant = { de: addDias(iv.de, -n), ate: addDias(iv.de, -1) };
    let primeira = '';
    for (const a of st.base.abastecimentos) if (a.data && (!primeira || a.data < primeira)) primeira = a.data;
    return primeira && primeira <= ant.de ? ant : null;
  }

  // ---------- dimensões (o que pode ser selecionado) ----------
  const NOME_CUSTO = { DIESEL: 'Diesel', MULTAS: 'Multas', ARLA: 'Arla 32', OUTROS: 'Outros combustíveis' };
  const tipoCusto = a => (a.combustivel === 'DIESEL' ? 'DIESEL' : a.combustivel === 'ARLA' ? 'ARLA' : 'OUTROS');
  const chavePeriodo = d => (d ? (st.mensal ? d.slice(0, 7) : semanaDe(d)) : '');
  const rotuloPeriodo = k => (st.mensal ? k.slice(5, 7) + '/' + k.slice(0, 4) : 'Semana de ' + dBR(k).slice(0, 5));
  let classeDaPlaca = new Map();

  const DIM = {
    custo: { nome: 'Tipo de custo', a: tipoCusto, m: () => 'MULTAS', rot: v => NOME_CUSTO[v] || v },
    unidade: { nome: 'Unidade', a: a => a.unidade, m: m => m.unidade },
    uf: { nome: 'Estado', a: a => a.uf || 'N/I', m: m => m.ufCalc, rot: v => (D.NOMES_UF[v] ? `${v} · ${D.NOMES_UF[v]}` : v) },
    classe: { nome: 'Classe ABC', a: a => classeDaPlaca.get(a.placa) || '—', m: m => classeDaPlaca.get(m.placa) || '—', rot: v => 'Classe ' + v },
    placa: { nome: 'Placa', a: a => a.placa, m: m => m.placa },
    motorista: { nome: 'Motorista', a: a => a.motorista || '(sem nome)', m: m => m.motorista || '(sem nome)' },
    periodo: { nome: 'Período', a: a => chavePeriodo(a.data), m: m => chavePeriodo(m.data), rot: v => rotuloPeriodo(v) }
  };
  const rot = (dim, v) => (DIM[dim].rot ? DIM[dim].rot(v) : v);

  function noPeriodo() { return D.filtrar(st.ctx, intervalo()); }

  /** Dados filtrados por período + todas as seleções, menos a dimensão `ignorar`. */
  function dados(ignorar) {
    const base = noPeriodo();
    const ativas = Object.keys(DIM).filter(k => k !== ignorar && st.sel[k].size);
    if (!ativas.length) return base;
    const passa = (x, tipo) => ativas.every(k => st.sel[k].has(DIM[k][tipo](x)));
    return { ab: base.ab.filter(a => passa(a, 'a')), mu: base.mu.filter(m => passa(m, 'm')) };
  }

  function atualizarClasses() {
    const { ab, mu } = dados('classe');
    classeDaPlaca = new Map(D.curvaABC(D.porPlaca(ab, mu, st.ctx), p => p.custoDiesel).map(p => [p.placa, p.classe]));
  }

  /** Clique num item: seleciona só ele; Ctrl/Shift soma ou tira. */
  function selecionar(dim, valores, multi) {
    const s = st.sel[dim];
    valores = valores.filter(v => v != null && v !== '');
    if (!valores.length) return;
    if (multi) {
      const todos = valores.every(v => s.has(v));
      valores.forEach(v => (todos ? s.delete(v) : s.add(v)));
    } else {
      const igual = s.size === valores.length && valores.every(v => s.has(v));
      s.clear();
      if (!igual) valores.forEach(v => s.add(v));
    }
    renderPainel();
  }
  const multiClique = e => !!(e && (e.ctrlKey || e.metaKey || e.shiftKey));
  function limparTudo() { Object.values(st.sel).forEach(s => s.clear()); renderPainel(); }

  // ---------- cores estáveis por unidade (a cor segue a unidade, não a posição) ----------
  function definirCores() {
    const tot = new Map();
    for (const a of st.ctx.abast) tot.set(a.unidade, (tot.get(a.unidade) || 0) + a.valor);
    for (const m of st.ctx.multas) tot.set(m.unidade, (tot.get(m.unidade) || 0) + m.valor);
    const lista = [...tot.entries()].filter(([u]) => u !== D.SEM_UNIDADE).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    st.coresUnidade = new Map(lista.slice(0, 8).map(([u], i) => [u, SERIES[i]]));
  }
  const corUnidade = u => css(st.coresUnidade.get(u) || '--outros');
  const COR_CUSTO = { DIESEL: '--s1', MULTAS: '--s2', ARLA: '--s3', OUTROS: '--s4' };
  const COR_CLASSE = { A: '--s1', B: '--s7', C: '--outros' };

  // ---------- rosca com seleção ----------
  function rosca(id, itens, opc = {}) {
    const el = document.getElementById(id);
    if (st.graficos[id]) { st.graficos[id].destroy(); delete st.graficos[id]; }
    itens = itens.filter(i => i.valor > 0);
    const total = itens.reduce((s, i) => s + i.valor, 0);
    if (!total) { el.innerHTML = `<div class="vazio">Sem dados para esta seleção</div>`; return; }
    const max = opc.max || 7;
    if (itens.length > max) {
      const resto = itens.slice(max - 1);
      itens = itens.slice(0, max - 1).concat([{ nome: 'Outros', valor: resto.reduce((s, i) => s + i.valor, 0), cor: css('--outros'), extra: `${resto.length} itens`, chaves: resto.flatMap(i => i.chaves || [i.chave]) }]);
    }
    const dim = opc.dim, sel = dim ? st.sel[dim] : null;
    const chavesDe = i => i.chaves || (i.chave != null ? [i.chave] : []);
    const marcado = i => sel && sel.size && chavesDe(i).some(k => sel.has(k));
    const temSel = sel && sel.size > 0;
    const fmt = opc.fmt || brl, fmtLeg = opc.fmt || brlCurto;
    el.innerHTML = `<div class="rosca"><div class="rosca-graf"><canvas></canvas><div class="rosca-centro"><b class="num">${esc(opc.centro ?? brlCurto(total))}</b><span>${esc(opc.centroSub || 'total')}</span></div></div>
      <ul class="legenda">${itens.map((i, k) => `<li data-k="${k}" class="${temSel ? (marcado(i) ? 'marcado' : 'apagado') : ''}" title="${esc(i.nome)}${dim ? ' · clique para filtrar' : ''}"><span class="cor" style="background:${i.cor}"></span><span class="nome">${esc(i.nome)}${i.extra ? ` <small style="color:var(--text-3)">· ${esc(i.extra)}</small>` : ''}</span><span class="val num">${fmtLeg(i.valor)}</span><span class="pct num">${pct(i.valor / total)}</span></li>`).join('')}</ul></div>`;
    const ch = new Chart(el.querySelector('canvas'), {
      type: 'doughnut',
      data: { labels: itens.map(i => i.nome), datasets: [{ data: itens.map(i => i.valor), backgroundColor: itens.map(i => (temSel && !marcado(i) ? apagar(i.cor) : i.cor)), borderColor: css('--surface'), borderWidth: 2, hoverOffset: 6, borderRadius: 3 }] },
      options: {
        cutout: '70%', responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        layout: { padding: 6 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw / total, 1)})` } } },
        onClick: (e, els) => { if (els.length && dim) selecionar(dim, chavesDe(itens[els[0].index]), multiClique(e.native)); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length && dim ? 'pointer' : 'default'; }
      }
    });
    st.graficos[id] = ch;
    el.querySelectorAll('.legenda li').forEach(li => {
      const k = +li.dataset.k;
      li.addEventListener('mouseenter', () => { ch.setActiveElements([{ datasetIndex: 0, index: k }]); ch.tooltip.setActiveElements([{ datasetIndex: 0, index: k }], { x: 0, y: 0 }); ch.update(); });
      li.addEventListener('mouseleave', () => { ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update(); });
      if (dim) li.addEventListener('click', e => selecionar(dim, chavesDe(itens[k]), multiClique(e)));
    });
  }

  // ---------- KPIs ----------
  function kpi(rotulo, val, sub, delta, cls = '') {
    let d = '';
    if (delta != null && isFinite(delta) && Math.abs(delta) >= 0.005) d = `<span class="delta ${delta > 0 ? 'sobe' : 'desce'}" title="vs. período anterior">${delta > 0 ? '▲' : '▼'} ${pct(Math.abs(delta))}</span>`;
    return `<div class="kpi ${cls}"><div class="kpi-rot">${rotulo}${d}</div><div class="kpi-val num">${val}</div><div class="kpi-sub">${sub}</div></div>`;
  }
  const variacao = (a, b) => (a == null || b == null || !b ? null : a / b - 1);

  // ---------- painel ----------
  function renderPainel() {
    const iv = intervalo();
    const per = noPeriodo();
    const datas = [...per.ab, ...per.mu].map(x => x.data).filter(Boolean).sort();
    st.mensal = datas.length ? new Set(datas.map(semanaDe)).size > 26 : false;
    atualizarClasses();

    const { ab, mu } = dados(null);
    const I = D.indicadores(ab, mu);
    const ant = intervaloAnterior(iv);
    let P = null;
    if (ant && !st.sel.periodo.size) {
      const salvo = st.filtro; st.filtro = { p: 'livre', de: ant.de, ate: ant.ate };
      const r = dados(null); st.filtro = salvo;
      if (r.ab.length || r.mu.length) P = D.indicadores(r.ab, r.mu);
    }

    const qtdSel = Object.values(st.sel).reduce((s, x) => s + x.size, 0);
    $('#periodoTxt').textContent = (iv.de ? `${dBR(iv.de)} a ${dBR(iv.ate)}` : 'Todo o histórico') + (P ? ' · setas comparam com o período anterior' : '');
    $('#btnLimparTudo').hidden = !qtdSel;
    $$('.cartao.visual').forEach(c => c.classList.toggle('com-sel', st.sel[c.dataset.dim]?.size > 0));

    $('#kpis').innerHTML = [
      kpi('Custo total', brlCurto(I.custoTotal), `${fNum(I.veiculos)} veículos · ${fNum(I.qtdAbast)} abastecimentos`, P && variacao(I.custoTotal, P.custoTotal), 'destaque'),
      kpi('Diesel', brlCurto(I.custoDiesel), `${fNum(I.litrosDiesel)} litros`, P && variacao(I.custoDiesel, P.custoDiesel)),
      kpi('Multas', brlCurto(I.custoMultas), `${fNum(I.qtdMultas)} infrações`, P && variacao(I.custoMultas, P.custoMultas)),
      kpi('Custo por km', I.rsKm == null ? '—' : fBRL3.format(I.rsKm), `${fNum(I.km)} km válidos`, P && variacao(I.rsKm, P.rsKm)),
      kpi('Km por litro', fNum(I.kmL, 2), 'média do diesel', P && I.kmL && P.kmL ? -(I.kmL / P.kmL - 1) : null),
      kpi('Preço do litro', I.rsLitro == null ? '—' : fBRL3.format(I.rsLitro), `Arla: ${pct(I.arlaPct, 1)} do diesel`, P && variacao(I.rsLitro, P.rsLitro))
    ].join('');

    // tipo de custo
    { const r = dados('custo'), J = D.indicadores(r.ab, r.mu);
      rosca('rCompos', [['DIESEL', J.custoDiesel], ['MULTAS', J.custoMultas], ['ARLA', J.custoArla], ['OUTROS', J.custoOutros]]
        .map(([k, v]) => ({ nome: NOME_CUSTO[k], chave: k, valor: v, cor: css(COR_CUSTO[k]) })), { dim: 'custo' }); }

    // por unidade
    { const r = dados('unidade'), U = D.porUnidade(r.ab, r.mu);
      rosca('rUnidade', U.map(u => ({ nome: u.unidade, chave: u.unidade, valor: u.custoTotal, cor: corUnidade(u.unidade) })).sort((a, b) => b.valor - a.valor),
        { dim: 'unidade', centroSub: `${U.length} unidades` });
      const MU = U.filter(u => u.custoMultas > 0);
      $('#subMultas').textContent = `${fNum(D.soma(MU, u => u.qtdMultas))} infrações · valor cheio, pela data`;
      rosca('rMultas', MU.map(u => ({ nome: u.unidade, chave: u.unidade, valor: u.custoMultas, cor: corUnidade(u.unidade), extra: fNum(u.qtdMultas) })).sort((a, b) => b.valor - a.valor), { dim: 'unidade' });
      renderRanking(U, D.indicadores(r.ab, r.mu)); }

    // por estado (combustível)
    { const r = dados('uf');
      const g = D.agrupar(r.ab, a => a.uf || 'N/I');
      const ufs = [...g.entries()].map(([uf, l]) => ({ uf, valor: D.soma(l, a => a.valor) })).sort((a, b) => b.valor - a.valor);
      // cor segue o estado: ordem fixa pelo total do período inteiro
      const ordem = [...D.agrupar(per.ab, a => a.uf || 'N/I').entries()].map(([uf, l]) => [uf, D.soma(l, a => a.valor)]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
      rosca('rEstado', ufs.map(u => ({ nome: rot('uf', u.uf), chave: u.uf, valor: u.valor, cor: css(SERIES[ordem.indexOf(u.uf)] || '--outros') })),
        { dim: 'uf', max: 6, centroSub: `${ufs.length} estados` }); }

    // curva ABC
    { const r = dados('classe');
      const abc = D.curvaABC(D.porPlaca(r.ab, r.mu, st.ctx), p => p.custoDiesel);
      const de = c => abc.filter(x => x.classe === c);
      rosca('rABC', ['A', 'B', 'C'].map(c => ({ nome: `${c} · ${de(c).length} veículos`, chave: c, valor: D.soma(de(c), x => x.valorABC), cor: css(COR_CLASSE[c]) })),
        { dim: 'classe', centro: fNum(abc.length), centroSub: 'veículos' }); }

    // eficiência (não filtra: é qualidade do dado)
    rosca('rEfic', [
      { nome: 'Km válido', valor: I.qtdDiesel - I.qtdKmInvalido, cor: css('--s3') },
      { nome: 'Hodômetro com erro', valor: I.qtdKmInvalido, cor: css('--s2') }
    ], { fmt: v => fNum(v), centro: pct(I.qtdDiesel ? (I.qtdDiesel - I.qtdKmInvalido) / I.qtdDiesel : null), centroSub: 'dos abastecimentos' });
    if (I.qtdDiesel) $('#rEfic').insertAdjacentHTML('beforeend', `<div style="display:flex;gap:18px;margin-top:12px;font-size:12.5px;color:var(--text-2);flex-wrap:wrap"><span>R$/km <b class="num" style="color:var(--text)">${I.rsKm == null ? '—' : fBRL3.format(I.rsKm)}</b></span><span>km/L <b class="num" style="color:var(--text)">${fNum(I.kmL, 2)}</b></span><span>Arla <b class="num" style="color:var(--text)">${pct(I.arlaPct, 1)}</b></span></div>`);

    renderEvolucao();
    renderMotoristas();
    renderPlacas();
    renderAtencao(ab, mu);
    renderLancamentos(ab, mu);
    renderSlicers();
    renderChips();
    if ($('#tela-dados').classList.contains('ativa')) renderDados();
  }

  function chipVsMedia(v, media, menorMelhor, fmt) {
    if (v == null) return '<span class="chip neutro">—</span>';
    if (media == null) return `<span class="chip neutro">${fmt(v)}</span>`;
    const melhor = menorMelhor ? v <= media : v >= media;
    return `<span class="chip ${melhor ? 'bom' : 'ruim'}" title="Média: ${fmt(media)}">${melhor ? '●' : '▲'} ${fmt(v)}</span>`;
  }
  function classeLinha(dim, chave) { const s = st.sel[dim]; return s.size ? (s.has(chave) ? 'marcado' : 'apagado') : ''; }

  function renderRanking(U, I) {
    const total = I.custoTotal || 1;
    const cols = [
      ['unidade', 'Unidade'], ['custoTotal', 'Custo total', 1], ['custoDiesel', 'Diesel', 1], ['litrosDiesel', 'Litros', 1], ['km', 'Km válidos', 1],
      ['rsKm', 'R$/km', 1], ['kmL', 'km/L', 1], ['rsLitro', 'R$/litro', 1], ['qtdMultas', 'Multas', 1], ['custoMultas', 'R$ multas', 1]
    ];
    const { col, dir } = st.ordem;
    U = [...U].sort((a, b) => { const x = a[col], y = b[col]; if (typeof x === 'string') return dir * x.localeCompare(y); return dir * ((x ?? -Infinity) - (y ?? -Infinity)); });
    const t = $('#tabUnidades');
    if (!U.length) { t.innerHTML = `<tr><td class="vazio">Sem dados para esta seleção</td></tr>`; return; }
    t.innerHTML = `<thead><tr>${cols.map(([k, n, d]) => `<th data-c="${k}" class="${d ? 'dir' : ''}">${n}${col === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${U.map(u => {
      const p = u.custoTotal / total, cor = corUnidade(u.unidade);
      return `<tr class="clicavel ${classeLinha('unidade', u.unidade)}" data-v="${esc(u.unidade)}">
        <td><span class="unid-cor" style="background:${cor}"></span><b>${esc(u.unidade)}</b></td>
        <td class="dir"><span class="cel-anel"><span class="num">${brl(u.custoTotal)}</span><span class="mini-anel" style="background:conic-gradient(${cor} ${p * 360}deg, var(--surface-2) 0)" title="${pct(p, 1)} do custo"></span><span class="num" style="width:38px;color:var(--text-3)">${pct(p)}</span></span></td>
        <td class="dir num">${brl(u.custoDiesel)}</td><td class="dir num">${fNum(u.litrosDiesel)}</td><td class="dir num">${fNum(u.km)}</td>
        <td class="dir">${chipVsMedia(u.rsKm, I.rsKm, true, v => fBRL3.format(v))}</td>
        <td class="dir">${chipVsMedia(u.kmL, I.kmL, false, v => fNum(v, 2))}</td>
        <td class="dir">${chipVsMedia(u.rsLitro, I.rsLitro, true, v => fBRL3.format(v))}</td>
        <td class="dir num">${fNum(u.qtdMultas)}</td><td class="dir num">${brl(u.custoMultas)}</td></tr>`;
    }).join('')}</tbody>`;
    t.querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const c = th.dataset.c; st.ordem = { col: c, dir: st.ordem.col === c ? -st.ordem.dir : (c === 'unidade' ? 1 : -1) }; renderPainel(); }));
    t.querySelectorAll('tr[data-v]').forEach(tr => tr.addEventListener('click', e => selecionar('unidade', [tr.dataset.v], multiClique(e))));
  }

  function renderEvolucao() {
    const { ab, mu } = dados('periodo');
    const per = noPeriodo();
    const chaves = [...new Set([...per.ab, ...per.mu].map(x => chavePeriodo(x.data)).filter(Boolean))].sort();
    const soma = (arr, f) => { const m = new Map(chaves.map(c => [c, 0])); for (const x of arr) { const k = chavePeriodo(x.data); if (m.has(k) && f(x)) m.set(k, m.get(k) + x.valor); } return [...m.values()]; };
    const series = [
      ['Diesel', soma(ab, a => a.combustivel === 'DIESEL'), '--s1'],
      ['Arla e outros', soma(ab, a => a.combustivel !== 'DIESEL'), '--s3'],
      ['Multas', soma(mu, () => true), '--s2']
    ];
    if (st.graficos.gEvol) st.graficos.gEvol.destroy();
    $('#tituloEvol').textContent = st.mensal ? 'Evolução mensal' : 'Evolução semanal';
    const sel = st.sel.periodo;
    const rotulos = chaves.map(k => (st.mensal ? k.slice(5, 7) + '/' + k.slice(2, 4) : dBR(k).slice(0, 5)));
    const grade = css('--border'), txt = css('--text-3');
    st.graficos.gEvol = new Chart($('#gEvol'), {
      type: 'bar',
      data: { labels: rotulos, datasets: series.map(([label, data, cor]) => ({
        label, data, backgroundColor: chaves.map(k => (sel.size && !sel.has(k) ? apagar(css(cor)) : css(cor))),
        borderColor: css('--surface'), borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 34
      })) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        interaction: { mode: 'index', intersect: false },
        onClick: (e, els) => { if (els.length) selecionar('periodo', [chaves[els[0].index]], multiClique(e.native)); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: txt } },
          y: { stacked: true, grid: { color: grade }, border: { display: false }, ticks: { color: txt, callback: v => brlCurto(v) } }
        },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { color: css('--text-2'), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
          tooltip: { callbacks: { title: c => rotuloPeriodo(chaves[c[0].dataIndex]), label: c => ` ${c.dataset.label}: ${brl(c.raw)}`, footer: c => 'Total: ' + brl(c.reduce((s, x) => s + x.raw, 0)) } }
        }
      }
    });
  }

  function renderMotoristas() {
    const { ab, mu } = dados('motorista');
    const m = new Map();
    const add = (nome, campo, v) => { if (!m.has(nome)) m.set(nome, { nome, comb: 0, multas: 0 }); m.get(nome)[campo] += v; };
    for (const a of ab) add(DIM.motorista.a(a), 'comb', a.valor);
    for (const x of mu) add(DIM.motorista.m(x), 'multas', x.valor);
    let lista = [...m.values()].map(x => Object.assign(x, { total: x.comb + x.multas })).sort((a, b) => b.total - a.total);
    // mantém visíveis os selecionados mesmo fora do top 10
    const top = lista.slice(0, 10);
    for (const s of st.sel.motorista) if (!top.some(x => x.nome === s)) { const x = lista.find(y => y.nome === s); if (x) top.push(x); }
    const el = $('#barMotoristas');
    if (!top.length) { el.innerHTML = `<div class="vazio">Sem dados para esta seleção</div>`; return; }
    const maior = Math.max(...top.map(x => x.total)) || 1;
    el.innerHTML = `<div class="barras-leg"><span><i style="background:var(--s1)"></i>Combustível</span><span><i style="background:var(--s2)"></i>Multas</span></div>` +
      top.map(x => `<div class="barra ${classeLinha('motorista', x.nome)}" data-v="${esc(x.nome)}" title="${esc(x.nome)}: combustível ${brl(x.comb)} · multas ${brl(x.multas)}">
        <span class="nome">${esc(x.nome)}</span>
        <span class="trilho">${x.comb ? `<span style="width:${(x.comb / maior) * 100}%;background:var(--s1)"></span>` : ''}${x.multas ? `<span style="width:${(x.multas / maior) * 100}%;background:var(--s2)"></span>` : ''}</span>
        <span class="val">${brlCurto(x.total)}</span></div>`).join('');
    el.querySelectorAll('.barra').forEach(b => b.addEventListener('click', e => selecionar('motorista', [b.dataset.v], multiClique(e))));
  }

  function renderPlacas() {
    const { ab, mu } = dados('placa');
    const abc = D.curvaABC(D.porPlaca(ab, mu, st.ctx), p => p.custoDiesel);
    const kmLmed = D.indicadores(ab, []).kmL;
    const t = $('#tabPlacas');
    if (!abc.length) { t.innerHTML = `<tr><td class="vazio">Sem abastecimentos de diesel para esta seleção</td></tr>`; return; }
    t.innerHTML = `<thead><tr><th>Classe</th><th>Placa</th><th>Unidade</th><th class="dir">Diesel</th><th class="dir">% acum.</th><th class="dir">Km válidos</th><th class="dir">km/L</th><th class="dir">Multas</th></tr></thead><tbody>${abc.map(p => `
      <tr class="clicavel ${classeLinha('placa', p.placa)}" data-v="${esc(p.placa)}" title="${esc(p.modelo)}"><td><span class="abc-badge abc-${p.classe}">${p.classe}</span></td><td><b>${esc(p.placa)}</b></td><td><span class="unid-cor" style="background:${corUnidade(p.unidade)}"></span>${esc(p.unidade)}</td>
      <td class="dir num">${brl(p.custoDiesel)}</td><td class="dir num">${pct(p.acumulado)}</td><td class="dir num">${fNum(p.km)}</td>
      <td class="dir">${chipVsMedia(p.kmL, kmLmed, false, v => fNum(v, 2))}</td><td class="dir num">${p.qtdMultas ? brl(p.custoMultas) : '—'}</td></tr>`).join('')}</tbody>`;
    t.querySelectorAll('tr[data-v]').forEach(tr => tr.addEventListener('click', e => selecionar('placa', [tr.dataset.v], multiClique(e))));
  }

  function renderLancamentos(ab, mu) {
    $$('#abasLanc button').forEach(b => {
      b.classList.toggle('ativo', b.dataset.l === st.lancAba);
      b.textContent = (b.dataset.l === 'ab' ? 'Abastecimentos' : 'Multas') + ` (${fNum(b.dataset.l === 'ab' ? ab.length : mu.length)})`;
    });
    const t = $('#tabLanc');
    const lim = 300;
    if (st.lancAba === 'ab') {
      const l = [...ab].sort((a, b) => (b.data + b.hora).localeCompare(a.data + a.hora));
      $('#subLanc').textContent = l.length > lim ? `Os ${lim} mais recentes de ${fNum(l.length)}. A aba Dados mostra e exporta todos.` : 'Tudo o que está por trás dos números acima';
      t.innerHTML = l.length ? `<thead><tr><th>Data</th><th>Placa</th><th>Unidade</th><th>Motorista</th><th>Posto</th><th>UF</th><th>Combustível</th><th class="dir">Litros</th><th class="dir">R$/L</th><th class="dir">Valor</th><th class="dir">Km</th></tr></thead><tbody>${l.slice(0, lim).map(a => `
        <tr><td>${dBR(a.data)} <small style="color:var(--text-3)">${esc(a.hora)}</small></td><td><b>${esc(a.placa)}</b></td><td>${esc(a.unidade)}</td><td>${esc(a.motorista)}</td><td>${esc(a.posto)}</td><td>${esc(a.uf)}</td><td>${esc(a.combustivelNome)}</td>
        <td class="dir num">${fNum(a.litros, 1)}</td><td class="dir num">${a.preco == null ? '—' : fBRL3.format(a.preco)}</td><td class="dir num">${brl(a.valor)}</td><td class="dir num" style="${a.combustivel === 'DIESEL' && !a.kmValido ? 'color:var(--critical)' : ''}">${fNum(a.km)}</td></tr>`).join('')}</tbody>` : `<tr><td class="vazio">Nenhum abastecimento nesta seleção</td></tr>`;
    } else {
      const l = [...mu].sort((a, b) => String(b.data).localeCompare(String(a.data)));
      $('#subLanc').textContent = 'Tudo o que está por trás dos números acima';
      t.innerHTML = l.length ? `<thead><tr><th>Data</th><th>Placa</th><th>Unidade</th><th>UF</th><th>Local</th><th>Infração</th><th>Motorista</th><th class="dir">Valor</th></tr></thead><tbody>${l.slice(0, lim).map(m => `
        <tr><td>${dBR(m.data)}</td><td><b>${esc(m.placa)}</b></td><td>${esc(m.unidade)}</td><td>${esc(m.ufCalc)}</td><td style="white-space:normal;max-width:300px">${esc(m.local)}</td><td style="white-space:normal;max-width:260px">${esc(m.tipo)}</td><td>${esc(m.motorista)}</td><td class="dir num">${brl(m.valor)}</td></tr>`).join('')}</tbody>` : `<tr><td class="vazio">Nenhuma multa nesta seleção</td></tr>`;
    }
  }

  // ---------- filtros laterais (segmentações) ----------
  const SLICERS = ['custo', 'unidade', 'uf', 'classe', 'placa', 'motorista'];
  function renderSlicers() {
    const el = $('#slicers');
    const aberto = document.activeElement && document.activeElement.classList.contains('fl-busca') ? document.activeElement.dataset.dim : null;
    el.innerHTML = SLICERS.map(dim => {
      const { ab, mu } = dados(dim);
      const tot = new Map();
      for (const a of ab) { const k = DIM[dim].a(a); tot.set(k, (tot.get(k) || 0) + a.valor); }
      for (const m of mu) { const k = DIM[dim].m(m); tot.set(k, (tot.get(k) || 0) + m.valor); }
      for (const s of st.sel[dim]) if (!tot.has(s)) tot.set(s, 0);
      let ops = [...tot.entries()].filter(([k]) => k && k !== '—').sort((a, b) => (dim === 'classe' ? a[0].localeCompare(b[0]) : b[1] - a[1]));
      const busca = semAcento(st.buscaSlicer[dim] || '');
      if (busca) ops = ops.filter(([k]) => semAcento(rot(dim, k)).includes(busca));
      const comBusca = dim === 'placa' || dim === 'motorista' || dim === 'unidade';
      const limite = st.slicerTodos[dim] ? Infinity : 8;
      const s = st.sel[dim];
      return `<div class="fl-bloco"><h4>${DIM[dim].nome}${s.size ? `<span class="qtd">${s.size}</span><button class="limpa" data-limpa="${dim}">limpar</button>` : ''}</h4>
        ${comBusca ? `<input class="fl-busca" data-dim="${dim}" placeholder="Buscar…" value="${esc(st.buscaSlicer[dim] || '')}">` : ''}
        <div class="fl-lista">${ops.slice(0, limite).map(([k, v]) => `<label class="fl-op ${v ? '' : 'vazio-op'}" title="${esc(rot(dim, k))}"><input type="checkbox" data-dim="${dim}" data-v="${esc(k)}" ${s.has(k) ? 'checked' : ''}><span>${esc(rot(dim, k))}</span><small>${brlCurto(v)}</small></label>`).join('') || '<span class="contador">Nada encontrado</span>'}</div>
        ${ops.length > limite ? `<button class="fl-mais" data-mais="${dim}">ver todos (${ops.length})</button>` : ''}</div>`;
    }).join('');
    el.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', () => {
      const s = st.sel[c.dataset.dim]; c.checked ? s.add(c.dataset.v) : s.delete(c.dataset.v); renderPainel();
    }));
    el.querySelectorAll('[data-limpa]').forEach(b => b.addEventListener('click', () => { st.sel[b.dataset.limpa].clear(); renderPainel(); }));
    el.querySelectorAll('[data-mais]').forEach(b => b.addEventListener('click', () => { st.slicerTodos[b.dataset.mais] = true; renderSlicers(); }));
    el.querySelectorAll('.fl-busca').forEach(i => {
      i.addEventListener('input', () => { st.buscaSlicer[i.dataset.dim] = i.value; const pos = i.selectionStart; renderSlicers(); const n = $(`.fl-busca[data-dim="${i.dataset.dim}"]`); n.focus(); n.setSelectionRange(pos, pos); });
    });
    if (aberto) { const n = $(`.fl-busca[data-dim="${aberto}"]`); if (n && document.activeElement !== n) n.focus(); }
  }

  function renderChips() {
    const chips = [];
    for (const [dim, s] of Object.entries(st.sel)) for (const v of s) chips.push(`<span class="chip-sel"><i>${DIM[dim].nome}:</i> ${esc(rot(dim, v))}<button data-dim="${dim}" data-v="${esc(v)}" title="Tirar este filtro" aria-label="Tirar filtro">×</button></span>`);
    $('#chips').innerHTML = chips.join('') || '<span class="contador">Sem seleção: mostrando tudo do período</span>';
    $$('#chips button').forEach(b => b.addEventListener('click', () => { st.sel[b.dataset.dim].delete(b.dataset.v); renderPainel(); }));
    const n = chips.length;
    $('#btnAbrirFiltros').lastChild.textContent = n ? `Filtros (${n})` : 'Filtros';
  }

  // ---------- pontos de atenção (com correção) ----------
  function renderAtencao(ab, mu) {
    const A = D.pontosAtencao(st.ctx, ab, mu);
    const itens = [];
    const ufOpts = () => `<option value="">UF…</option>` + D.SIGLAS.map(s => `<option>${s}</option>`).join('');
    if (A.placasSemUnidade.size) itens.push({
      cls: 'crit', ic: '!', t: `${A.placasSemUnidade.size} placas sem unidade`, s: 'Os custos delas aparecem como "SEM UNIDADE". Defina a unidade aqui.',
      det: `<table><thead><tr><th>Placa</th><th>Registros</th><th>Unidade</th><th></th></tr></thead><tbody>${[...A.placasSemUnidade].map(([p, n]) => `<tr><td><b>${esc(p)}</b></td><td>${n}</td><td><input data-placa="${esc(p)}" list="listaUnidades" placeholder="Unidade"></td><td><button class="btn peq" data-acao="unid" data-placa="${esc(p)}">Salvar</button></td></tr>`).join('')}</tbody></table>`
    });
    if (A.multasSemUF.length) itens.push({
      cls: 'warn', ic: '?', t: `${A.multasSemUF.length} multas sem estado identificado`, s: 'Não deu para descobrir a UF pelo LOCAL. Escolha o estado.',
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Local</th><th class="dir">Valor</th><th>UF</th></tr></thead><tbody>${A.multasSemUF.slice(0, 60).map(m => `<tr><td>${dBR(m.data)}</td><td>${esc(m.placa)}</td><td style="white-space:normal;max-width:320px">${esc(m.local || '(vazio)')}</td><td class="dir num">${brl(m.valor)}</td><td><select data-acao="ufmulta" data-id="${esc(m.id)}">${ufOpts()}</select></td></tr>`).join('')}</tbody></table>`
    });
    if (A.kmInv.length) itens.push({
      cls: 'warn', ic: 'km', t: `${A.kmInv.length} abastecimentos com hodômetro inválido`, s: `Km zero ou acima de ${fNum(st.ctx.kmMax)} km. Ficam fora do R$/km e do km/L.`,
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Unidade</th><th class="dir">Km informado</th><th class="dir">Litros</th><th>Posto</th></tr></thead><tbody>${A.kmInv.slice(0, 60).map(a => `<tr><td>${dBR(a.data)}</td><td>${esc(a.placa)}</td><td>${esc(a.unidade)}</td><td class="dir num">${fNum(a.km)}</td><td class="dir num">${fNum(a.litros, 1)}</td><td>${esc(a.posto)}</td></tr>`).join('')}</tbody></table>`
    });
    if (A.precoAlto.length) itens.push({
      cls: 'info', ic: 'R$', t: `${A.precoAlto.length} abastecimentos com diesel caro`, s: `Litro mais de 15% acima da média da seleção (${fBRL3.format(A.mediaPreco)}).`,
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Posto</th><th>UF</th><th class="dir">R$/litro</th></tr></thead><tbody>${A.precoAlto.sort((a, b) => b.preco - a.preco).slice(0, 40).map(a => `<tr><td>${dBR(a.data)}</td><td>${esc(a.placa)}</td><td>${esc(a.posto)}</td><td>${esc(a.uf)}</td><td class="dir num">${fBRL3.format(a.preco)}</td></tr>`).join('')}</tbody></table>`
    });
    if (A.forasCadastro.size) itens.push({ cls: 'info', ic: 'i', t: `${A.forasCadastro.size} placas de multas fora do cadastro`, s: [...A.forasCadastro].join(', ') + '. Confira se a placa foi digitada certo ou cadastre o veículo.' });

    const el = $('#atencao');
    if (!itens.length) { el.innerHTML = `<div class="at-item"><div class="at-icone info" style="color:var(--good-text)">✓</div><div class="at-txt"><b>Tudo certo</b><span>Nenhum problema nos dados desta seleção.</span></div></div>`; return; }
    el.innerHTML = itens.map((i, k) => `<div class="at-item" data-k="${k}"><div class="at-icone ${i.cls}">${i.ic}</div><div class="at-txt"><b>${i.t}</b><span>${esc(i.s)}</span>${i.det ? `<div class="at-det tabela-wrap">${i.det}</div>` : ''}</div></div>`).join('');
    el.querySelectorAll('.at-item').forEach(it => it.addEventListener('click', e => { if (e.target.closest('.at-det')) return; it.classList.toggle('aberto'); }));
    el.querySelectorAll('button[data-acao="unid"]').forEach(b => b.addEventListener('click', () => {
      const v = el.querySelector(`input[data-placa="${b.dataset.placa}"]`).value.trim();
      if (!v) return toast('Digite a unidade');
      alterar(base => { base.ajustes.unidadePorPlaca[b.dataset.placa] = D.normUnidade(v); }, `Ajuste: unidade da placa ${b.dataset.placa}`);
    }));
    el.querySelectorAll('select[data-acao="ufmulta"]').forEach(s => s.addEventListener('change', () => {
      if (!s.value) return;
      alterar(base => { base.ajustes.ufPorMulta[s.dataset.id] = s.value; }, `Ajuste: UF da multa ${s.dataset.id}`);
    }));
  }

  // ---------- gravação segura ----------
  async function alterar(mudanca, mensagem) {
    if (!st.servidor) { toast('Sem servidor: abra pelo "Abrir Painel.bat" para gravar.'); return false; }
    try {
      const atual = (await D.carregar()).base; // sempre parte da versão gravada mais recente
      const r = await mudanca(atual);
      const res = await D.gravar(atual, mensagem);
      st.base = atual;
      recalcular();
      mostrarGit(res.git);
      toast(res.git?.push ? 'Salvo e enviado ao GitHub ✓' : res.git?.commit ? 'Salvo no git ✓' : 'Salvo ✓');
      return r ?? true;
    } catch (e) {
      toast('Erro ao salvar: ' + e.message, 6000);
      return false;
    }
  }

  // ---------- importar ----------
  async function importar(arquivos) {
    const res = $('#resultado');
    if (!st.servidor) { res.innerHTML = `<div class="res-item erro"><div class="at-icone crit">!</div><div class="at-txt"><b>Não importado</b><span>O servidor não está ligado, então os dados não seriam guardados. Abra o painel pelo arquivo "Abrir Painel.bat".</span></div></div>`; return; }
    res.innerHTML = `<div class="res-item"><div class="at-icone info">…</div><div class="at-txt"><b>Lendo ${arquivos.length} arquivo(s)…</b></div></div>`;
    const lidos = [];
    for (const f of arquivos) {
      try {
        const buf = await f.arrayBuffer();
        const r = D.lerArquivo(f.name, buf);
        const copia = await D.guardarArquivo(f.name, buf);
        lidos.push({ nome: f.name, tipo: r.tipo, registros: r.registros, copia });
      } catch (e) { lidos.push({ nome: f.name, erro: e.message }); }
    }
    const validos = lidos.filter(l => !l.erro);
    let git = null;
    if (validos.length) {
      const ok = await alterar(base => {
        for (const l of validos) {
          const m = D.mesclar(base, l.tipo, l.registros);
          Object.assign(l, m);
          base.importacoes.push({ quando: new Date().toISOString(), arquivo: l.nome, tipo: l.tipo, lidos: l.registros.length, novos: m.novos, atualizados: m.atualizados, copia: l.copia });
        }
      }, 'Importa ' + validos.map(l => l.nome).join(', '));
      if (!ok) validos.forEach(l => { l.erro = 'Lido, mas não foi possível gravar. Nada mudou na base.'; });
      git = ok;
    }
    const nomeTipo = { abastecimentos: 'Abastecimentos', multas: 'Multas', frota: 'Cadastro da frota' };
    res.innerHTML = lidos.map(l => l.erro
      ? `<div class="res-item erro"><div class="at-icone crit">!</div><div class="at-txt"><b>${esc(l.nome)}</b><span>${esc(l.erro)}</span></div></div>`
      : `<div class="res-item"><div class="at-icone info" style="color:var(--good-text)">✓</div><div class="at-txt"><b>${esc(l.nome)} · ${nomeTipo[l.tipo]}</b><span>${fNum(l.registros.length)} lidos · <b>${fNum(l.novos)} novos</b> · ${fNum(l.atualizados)} atualizados · ${fNum(l.iguais)} já existiam</span></div></div>`).join('');
    if (git) renderImportar();
  }

  function renderImportar() {
    const b = st.base, r = b.resumo || {};
    const datas = b.abastecimentos.map(a => a.data).filter(Boolean).sort();
    const datasM = b.multas.map(a => a.data).filter(Boolean).sort();
    $('#resumoBase').innerHTML = `<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
      ${kpi('Abastecimentos', fNum(b.abastecimentos.length), datas.length ? `${dBR(datas[0])} a ${dBR(datas.at(-1))}` : 'nenhum ainda')}
      ${kpi('Multas', fNum(b.multas.length), datasM.length ? `${dBR(datasM[0])} a ${dBR(datasM.at(-1))}` : 'nenhuma ainda')}
      ${kpi('Veículos', fNum(b.frota.length), 'no cadastro')}</div>
      <p class="sub" style="margin-top:12px">Última gravação: ${r.atualizado ? new Date(r.atualizado).toLocaleString('pt-BR') : '—'}</p>`;
    const imp = [...b.importacoes].reverse();
    $('#tabImport').innerHTML = imp.length ? `<thead><tr><th>Quando</th><th>Arquivo</th><th class="dir">Lidos</th><th class="dir">Novos</th></tr></thead><tbody>${imp.slice(0, 40).map(i => `<tr title="${esc(i.copia || '')}"><td>${new Date(i.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(i.arquivo)}</td><td class="dir num">${fNum(i.lidos)}</td><td class="dir num">${fNum(i.novos)}</td></tr>`).join('')}</tbody>` : `<tr><td class="vazio">Nenhuma importação ainda</td></tr>`;
  }

  // ---------- dados (respeita período e seleções do painel) ----------
  const DEF = {
    abastecimentos: {
      lista: () => dados(null).ab,
      cols: [['data', 'Data', dBR], ['hora', 'Hora'], ['placa', 'Placa'], ['unidade', 'Unidade'], ['motorista', 'Motorista'], ['posto', 'Posto'], ['cidade', 'Cidade'], ['uf', 'UF'], ['combustivelNome', 'Combustível'], ['litros', 'Litros', v => fNum(v, 2), 1], ['preco', 'R$/L', v => (v == null ? '—' : fBRL3.format(v)), 1], ['valor', 'Valor', brl, 1], ['km', 'Km', v => fNum(v), 1], ['kmValido', 'Km válido', v => (v ? 'Sim' : 'Não')]]
    },
    multas: {
      lista: () => dados(null).mu,
      cols: [['data', 'Data', dBR], ['placa', 'Placa'], ['unidade', 'Unidade'], ['ufCalc', 'UF'], ['local', 'Local'], ['tipo', 'Infração'], ['numero', 'Nº'], ['motorista', 'Motorista'], ['orgao', 'Órgão'], ['valor', 'Valor', brl, 1], ['venc', 'Vencimento', dBR], ['aba', 'Aba']]
    },
    frota: {
      lista: () => st.base.frota.map(f => Object.assign({}, f, { unidadeFinal: st.ctx.unidadePlaca(f.placa) })),
      cols: [['placa', 'Placa'], ['unidadeFinal', 'Unidade'], ['situacao', 'Situação'], ['tipo', 'Tipo'], ['modelo', 'Modelo']]
    },
    abc: {
      lista: () => { const { ab, mu } = dados(null); return D.curvaABC(D.porPlaca(ab, mu, st.ctx), p => p.custoDiesel); },
      cols: [['classe', 'Classe'], ['placa', 'Placa'], ['unidade', 'Unidade'], ['modelo', 'Modelo'], ['custoDiesel', 'Diesel', brl, 1], ['pct', '% do diesel', v => pct(v, 1), 1], ['acumulado', '% acumulado', v => pct(v, 1), 1], ['litrosDiesel', 'Litros', v => fNum(v), 1], ['km', 'Km válidos', v => fNum(v), 1], ['kmL', 'km/L', v => fNum(v, 2), 1], ['rsKm', 'R$/km', v => (v == null ? '—' : fBRL3.format(v)), 1], ['custoMultas', 'Multas', brl, 1]]
    }
  };
  function linhasDados() {
    const def = DEF[st.dadosAba];
    const q = semAcento($('#busca').value.trim());
    let l = def.lista();
    if (q) l = l.filter(r => def.cols.some(([k]) => semAcento(r[k]).includes(q)));
    return { def, l: st.dadosAba === 'abastecimentos' || st.dadosAba === 'multas' ? [...l].reverse() : l };
  }
  function renderDados() {
    const { def, l } = linhasDados();
    $('#contador').textContent = `${fNum(l.length)} registros${l.length > 800 ? ' · mostrando os 800 primeiros (a exportação leva todos)' : ''}`;
    $('#tabDados').innerHTML = `<thead><tr>${def.cols.map(([, n, , d]) => `<th class="${d ? 'dir' : ''}">${n}</th>`).join('')}</tr></thead><tbody>${l.slice(0, 800).map(r => `<tr>${def.cols.map(([k, , f, d]) => `<td class="${d ? 'dir num' : ''}">${k === 'classe' ? `<span class="abc-badge abc-${r[k]}">${r[k]}</span>` : esc(f ? f(r[k]) : r[k] ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td class="vazio" colspan="${def.cols.length}">Nada encontrado</td></tr>`}</tbody>`;
  }
  function exportarCSV() {
    const { def, l } = linhasDados();
    const cel = v => { if (v == null) return ''; if (typeof v === 'number') return String(v).replace('.', ','); if (typeof v === 'boolean') return v ? 'Sim' : 'Não'; const s = String(v); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const txt = [def.cols.map(c => c[1]).join(';'), ...l.map(r => def.cols.map(([k]) => cel(k === 'data' || k === 'venc' ? dBR(r[k]) : r[k])).join(';'))].join('\r\n');
    baixar(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }), `frota-${st.dadosAba}-${D.isoDe(new Date())}.csv`);
  }
  function baixar(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

  // ---------- ajustes ----------
  function renderAjustes() {
    const aj = st.base.ajustes;
    $('#ajKm').value = aj.kmMax;
    $('#ajLocalUF').innerHTML = D.SIGLAS.map(s => `<option>${s}</option>`).join('');
    const unidades = [...new Set([...st.ctx.abast.map(a => a.unidade), ...st.ctx.multas.map(m => m.unidade)])].filter(u => u !== D.SEM_UNIDADE).sort();
    $('#listaUnidades').innerHTML = unidades.map(u => `<option value="${esc(u)}">`).join('');
    const lp = Object.entries(aj.unidadePorPlaca).sort();
    $('#listaPlacas').innerHTML = lp.length ? lp.map(([p, u]) => `<div><span><b>${esc(p)}</b> → ${esc(u)}</span><button class="x" data-del-placa="${esc(p)}" title="Remover ajuste">×</button></div>`).join('') : '<p class="sub">Nenhum ajuste.</p>';
    const ll = Object.entries(aj.localUF || {}).sort();
    $('#listaLocais').innerHTML = ll.length ? ll.map(([t, u]) => `<div><span>"${esc(t)}" → <b>${esc(u)}</b></span><button class="x" data-del-local="${esc(t)}" title="Remover ajuste">×</button></div>`).join('') : '<p class="sub">Nenhum ajuste. Belém, São Luís, Cuiabá, Natal e Augusto Montenegro já são reconhecidos.</p>';
    $$('[data-del-placa]').forEach(b => b.onclick = () => alterar(base => { delete base.ajustes.unidadePorPlaca[b.dataset.delPlaca]; }, `Ajuste: remove unidade da placa ${b.dataset.delPlaca}`));
    $$('[data-del-local]').forEach(b => b.onclick = () => alterar(base => { delete base.ajustes.localUF[b.dataset.delLocal]; }, 'Ajuste: remove local → UF'));
  }

  // ---------- git ----------
  function mostrarGit(g) {
    const s = $('#seloGit');
    const set = (cls, txt, tit) => { s.className = 'selo ' + cls; s.lastElementChild.textContent = txt; s.title = tit || txt; };
    if (!st.servidor) return set('erro', 'Sem servidor', 'Abra pelo "Abrir Painel.bat" para gravar dados');
    if (g && g.detalhe && !g.push && g.commit === false) return set('erro', 'Erro ao salvar', g.detalhe);
    D.statusGit().then(x => {
      if (!x) return set('erro', 'Sem servidor');
      if (!x.repositorio) return set('alerta', 'Sem git', 'A pasta não é um repositório git: os dados ficam só neste computador');
      if (g && g.detalhe && !g.push && x.remoto) return set('alerta', 'GitHub pendente', g.detalhe);
      const quando = x.ultimoCommit ? x.ultimoCommit.split('|')[0] : '';
      if (!x.remoto) return set('alerta', 'Salvo no git · sem GitHub', 'Commits locais em dia. Configure o GitHub para ter cópia fora do computador. Último: ' + x.ultimoCommit);
      set('ok', 'Salvo · ' + quando, 'Último commit: ' + x.ultimoCommit);
    });
  }

  // ---------- geral ----------
  function recalcular() {
    st.ctx = D.contexto(st.base);
    definirCores();
    renderPainel();
    renderImportar();
    renderAjustes();
  }

  function ligar() {
    $$('#abas .aba').forEach(b => b.addEventListener('click', () => {
      $$('#abas .aba').forEach(x => x.classList.toggle('ativa', x === b));
      $$('.tela').forEach(t => t.classList.toggle('ativa', t.id === 'tela-' + b.dataset.tela));
      if (b.dataset.tela === 'dados') renderDados();
      if (b.dataset.tela === 'painel') renderPainel();
    }));
    $$('#segPeriodo button').forEach(b => b.addEventListener('click', () => {
      st.filtro.p = b.dataset.p;
      st.sel.periodo.clear(); // as semanas/meses mudam com o período
      $$('#segPeriodo button').forEach(x => x.classList.toggle('ativo', x === b));
      $('#campoDatas').hidden = b.dataset.p !== 'livre';
      if (b.dataset.p === 'livre' && !st.filtro.de) { const fim = ultimaData(); st.filtro.de = addDias(fim, -29); st.filtro.ate = fim; $('#fDe').value = st.filtro.de; $('#fAte').value = st.filtro.ate; }
      renderPainel();
    }));
    $('#fDe').addEventListener('change', e => { st.filtro.de = e.target.value; st.sel.periodo.clear(); renderPainel(); });
    $('#fAte').addEventListener('change', e => { st.filtro.ate = e.target.value; st.sel.periodo.clear(); renderPainel(); });
    $('#btnLimparTudo').addEventListener('click', limparTudo);
    $('#btnAbrirFiltros').addEventListener('click', () => $('#filtrosLado').classList.add('aberto'));
    $('#btnFecharFiltros').addEventListener('click', () => $('#filtrosLado').classList.remove('aberto'));
    $$('#abasLanc button').forEach(b => b.addEventListener('click', () => { st.lancAba = b.dataset.l; const { ab, mu } = dados(null); renderLancamentos(ab, mu); }));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if ($('#filtrosLado').classList.contains('aberto')) { $('#filtrosLado').classList.remove('aberto'); return; }
      if (e.target.closest && e.target.closest('input, select, textarea')) return;
      if (Object.values(st.sel).some(s => s.size)) { limparTudo(); toast('Seleções limpas'); }
    });

    const solta = $('#solta');
    $('#arquivos').addEventListener('change', e => { if (e.target.files.length) importar([...e.target.files]); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => solta.addEventListener(ev, e => { e.preventDefault(); solta.classList.add('sobre'); }));
    ['dragleave', 'drop'].forEach(ev => solta.addEventListener(ev, e => { e.preventDefault(); solta.classList.remove('sobre'); }));
    solta.addEventListener('drop', e => { if (e.dataTransfer.files.length) importar([...e.dataTransfer.files]); });

    $$('#subDados button').forEach(b => b.addEventListener('click', () => { st.dadosAba = b.dataset.d; $$('#subDados button').forEach(x => x.classList.toggle('ativo', x === b)); renderDados(); }));
    let tb; $('#busca').addEventListener('input', () => { clearTimeout(tb); tb = setTimeout(renderDados, 180); });
    $('#btnCSV').addEventListener('click', exportarCSV);

    $('#ajKmSalvar').addEventListener('click', () => { const v = +$('#ajKm').value; if (!(v >= 100)) return toast('Informe um valor a partir de 100 km'); alterar(b => { b.ajustes.kmMax = v; }, `Ajuste: km máximo ${v}`); });
    $('#ajPlacaAdd').addEventListener('click', () => { const p = D.normPlaca($('#ajPlaca').value), u = $('#ajUnidade').value.trim(); if (!p || !u) return toast('Preencha placa e unidade'); alterar(b => { b.ajustes.unidadePorPlaca[p] = D.normUnidade(u); }, `Ajuste: unidade da placa ${p}`).then(ok => { if (ok) { $('#ajPlaca').value = ''; $('#ajUnidade').value = ''; } }); });
    $('#ajLocalAdd').addEventListener('click', () => { const t = $('#ajLocal').value.trim().toUpperCase(), u = $('#ajLocalUF').value; if (!t) return toast('Digite o trecho do local'); alterar(b => { b.ajustes.localUF[t] = u; }, `Ajuste: local ${t} → ${u}`).then(ok => { if (ok) $('#ajLocal').value = ''; }); });
    $('#btnBackup').addEventListener('click', () => baixar(new Blob([JSON.stringify(st.base, null, 1)], { type: 'application/json' }), `painel-frota-backup-${D.isoDe(new Date())}.json`));

    $('#btnTema').addEventListener('click', () => {
      const escuro = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.dataset.theme = escuro ? 'light' : 'dark';
      try { localStorage.setItem('painelFrota.tema', document.documentElement.dataset.theme); } catch (e) {}
      renderPainel();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderPainel());
  }

  async function iniciar() {
    try { const t = localStorage.getItem('painelFrota.tema'); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
    if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.color = css('--text-2'); }
    ligar();
    const { base, origem } = await D.carregar();
    st.base = base;
    st.servidor = origem === 'servidor';
    $('#avisoServidor').classList.toggle('mostra', !st.servidor);
    recalcular();
    mostrarGit();
    if (!st.base.abastecimentos.length && !st.base.multas.length) {
      $$('#abas .aba')[1].click();
      toast('Comece importando as planilhas', 4000);
    }
  }

  // Para testes no console: App.importarBuffer(nome, arrayBuffer)
  window.App = { estado: st, selecionar, limparTudo, importarBuffer: (nome, buf) => importar([new File([buf], nome)]) };
  if (!window.XLSX || !window.Chart) { document.body.insertAdjacentHTML('afterbegin', '<div class="aviso mostra" style="margin:16px">Não consegui carregar as bibliotecas (sem internet?). O painel precisa de internet para abrir os gráficos e ler as planilhas.</div>'); }
  else iniciar();
})();
