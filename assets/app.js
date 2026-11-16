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
    filtro: { p: '30', de: '', ate: '', semOff: 0 },
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
    if (f.p === 'sem') { const seg = addDias(semanaDe(fim), 7 * f.semOff); return { de: seg, ate: addDias(seg, 6) }; }
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
    $('#semNav').hidden = st.filtro.p !== 'sem';
    if (st.filtro.p === 'sem') { $('#semTxt').textContent = `${dBR(iv.de).slice(0, 5)} a ${dBR(iv.ate)}`; $('#semProx').disabled = st.filtro.semOff >= 0; }
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

    renderMapaPainel();
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
    const abertos = A.prazos.filter(p => !p.vencido), vencidos = A.prazos.filter(p => p.vencido);
    if (A.prazos.length) itens.push({
      cls: 'crit', ic: '⏰', t: `${abertos.length ? `${abertos.length} prazos de multa nos próximos 10 dias` : ''}${abertos.length && vencidos.length ? ' · ' : ''}${vencidos.length ? `${vencidos.length} vencidos há pouco` : ''}`,
      s: 'Identificação do condutor e defesa prévia. Vale para todas as multas, não só as do período.',
      det: `<table><thead><tr><th>Prazo</th><th>O quê</th><th>Placa</th><th>Unidade</th><th>Auto</th><th class="dir">Valor</th></tr></thead><tbody>${A.prazos.map(p => `<tr><td><b style="color:${p.vencido ? 'var(--text-3)' : 'var(--critical)'}">${dBR(p.prazo)}${p.hoje ? ' (hoje)' : p.vencido ? ' (vencido)' : ''}</b></td><td>${esc(p.oQue)}</td><td>${esc(p.multa.placa)}</td><td>${esc(p.multa.unidade)}</td><td>${esc(p.multa.numero)}</td><td class="dir num">${brl(p.multa.valor)}</td></tr>`).join('')}</tbody></table>`
    });
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

  // ---------- mapa do Brasil ----------
  const MAPA = window.MAPA_BR;
  const proj = (lat, lon) => [(lon - MAPA.LON0) * MAPA.C * MAPA.K, (MAPA.LAT1 - lat) * MAPA.K];
  const localUnidade = u => (st.base.ajustes.localUnidade || {})[u] || D.LOCAL_UNIDADES[u] || null;
  const escuro = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  function misturar(a, b, t) {
    const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
    const [r1, g1, b1] = h(a), [r2, g2, b2] = h(b);
    return `rgb(${Math.round(r1 + (r2 - r1) * t)},${Math.round(g1 + (g2 - g1) * t)},${Math.round(b1 + (b2 - b1) * t)})`;
  }
  const RAMPA = () => (escuro() ? ['#22324a', '#5598e7'] : ['#d6e6fa', '#1c5cab']);

  /** Monta o SVG do mapa. ufVal: Map(UF → R$); bolhas: [{unidade, valor}]. */
  function svgMapa({ ufVal = new Map(), bolhas = [], selUF = new Set(), selUnid = new Set(), siglas = true, ajuste = false }) {
    const maxUF = Math.max(0, ...ufVal.values());
    const [baixo, alto] = RAMPA();
    const temSel = selUF.size || selUnid.size;
    const ufs = Object.entries(MAPA.uf).map(([uf, d]) => {
      const v = ufVal.get(uf) || 0;
      const t = maxUF ? Math.sqrt(v / maxUF) : 0;
      const fill = ajuste || !v ? 'var(--surface-2)' : misturar(baixo, alto, t);
      const cls = selUF.size ? (selUF.has(uf) ? 'marcado' : 'apagado') : '';
      return `<path class="uf ${cls}" data-uf="${uf}" data-dica="${esc(D.NOMES_UF[uf] || uf)}${v ? ' · ' + brl(v) : ' · sem abastecimento'}" d="${d}" fill="${fill}"/>`;
    }).join('');
    const rot = siglas ? Object.entries(MAPA.centro).map(([uf, [x, y]]) => {
      const v = ufVal.get(uf) || 0, t = maxUF ? Math.sqrt(v / maxUF) : 0;
      return `<text class="uf-sigla" x="${x}" y="${y + 4}" text-anchor="middle" style="${!ajuste && t > .55 ? 'fill:#fff' : ''}">${uf}</text>`;
    }).join('') : '';
    const maxB = Math.max(0, ...bolhas.map(b => b.valor));
    const bs = bolhas.filter(b => localUnidade(b.unidade)).sort((a, b) => b.valor - a.valor).map(b => {
      const { lat, lon } = localUnidade(b.unidade);
      const [x, y] = proj(lat, lon);
      const r = ajuste ? 9 : 9 + 25 * Math.sqrt(maxB ? b.valor / maxB : 0);
      const cls = selUnid.size ? (selUnid.has(b.unidade) ? 'marcado' : 'apagado') : '';
      return `<g class="bolha ${cls}" data-unidade="${esc(b.unidade)}" data-dica="${esc(b.unidade)}${ajuste ? '' : ' · ' + brl(b.valor)}">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${ajuste ? css('--accent') : corUnidade(b.unidade)}" fill-opacity="${ajuste ? 1 : .88}"/>
        <text class="nome" x="${x.toFixed(1)}" y="${(y - r - 6).toFixed(1)}" text-anchor="middle">${esc(b.unidade)}</text>
        ${ajuste ? '' : `<text class="valor" x="${x.toFixed(1)}" y="${(y + r + 15).toFixed(1)}" text-anchor="middle">${esc(brlCurto(b.valor))}</text>`}</g>`;
    }).join('');
    return `<svg viewBox="-10 -30 ${MAPA.w + 20} ${MAPA.h + 40}" role="img" aria-label="Mapa do Brasil com as unidades">${ufs}${rot}${bs}</svg>`;
  }

  function ligarDicas(el) {
    let dica = el.querySelector('.mapa-dica');
    if (!dica) { dica = document.createElement('div'); dica.className = 'mapa-dica'; el.appendChild(dica); }
    el.onmousemove = e => {
      const alvo = e.target.closest('[data-dica]');
      if (!alvo) { dica.style.display = 'none'; return; }
      const b = el.getBoundingClientRect();
      dica.textContent = alvo.dataset.dica;
      dica.style.left = (e.clientX - b.left) + 'px'; dica.style.top = (e.clientY - b.top) + 'px'; dica.style.display = 'block';
    };
    el.onmouseleave = () => { dica.style.display = 'none'; };
  }

  function legendaMapa(ufVal, semLocal) {
    const [baixo, alto] = RAMPA();
    const vals = [...ufVal.values()].filter(v => v > 0);
    return `<div class="mapa-legenda"><span>Combustível por estado: ${brlCurto(vals.length ? Math.min(...vals) : 0)}<span class="grad" style="background:linear-gradient(90deg,${baixo},${alto})"></span>${brlCurto(vals.length ? Math.max(...vals) : 0)}</span>
      <span><svg width="34" height="16" style="vertical-align:middle"><circle cx="6" cy="8" r="4" fill="var(--text-3)"/><circle cx="24" cy="8" r="7" fill="var(--text-3)"/></svg> bolha = custo total da unidade</span></div>` +
      (semLocal.length ? `<div class="mapa-sem-local">Fora do mapa (sem local definido): ${semLocal.map(b => `${esc(b.unidade)} ${brlCurto(b.valor)}`).join(' · ')} — posicione em Ajustes.</div>` : '');
  }

  function renderMapaPainel() {
    const rUF = dados('uf'), rU = dados('unidade');
    const ufVal = new Map();
    for (const a of rUF.ab) if (a.uf) ufVal.set(a.uf, (ufVal.get(a.uf) || 0) + a.valor);
    const bolhas = D.porUnidade(rU.ab, rU.mu).filter(u => u.custoTotal > 0 && u.unidade !== D.SEM_UNIDADE).map(u => ({ unidade: u.unidade, valor: u.custoTotal }));
    const el = $('#mapaPainel');
    el.innerHTML = svgMapa({ ufVal, bolhas, selUF: st.sel.uf, selUnid: st.sel.unidade }) + legendaMapa(ufVal, bolhas.filter(b => !localUnidade(b.unidade)));
    ligarDicas(el);
    el.querySelectorAll('.uf').forEach(p => p.addEventListener('click', e => selecionar('uf', [p.dataset.uf], multiClique(e))));
    el.querySelectorAll('.bolha').forEach(g => g.addEventListener('click', e => { e.stopPropagation(); selecionar('unidade', [g.dataset.unidade], multiClique(e)); }));

    // barras de unidades ao lado do mapa
    const lista = D.porUnidade(rU.ab, rU.mu).filter(u => u.custoTotal > 0).sort((a, b) => b.custoTotal - a.custoTotal);
    const maior = lista.length ? lista[0].custoTotal : 1;
    $('#barUnidades').innerHTML = lista.length ? lista.map(u => `<div class="barra ${classeLinha('unidade', u.unidade)}" data-v="${esc(u.unidade)}" title="${esc(u.unidade)}: combustível ${brl(u.custoDiesel + u.custoArla + u.custoOutros)} · multas ${brl(u.custoMultas)}">
        <span class="nome"><span class="unid-cor" style="background:${corUnidade(u.unidade)}"></span>${esc(u.unidade)}</span>
        <span class="trilho"><span style="width:${(u.custoTotal / maior) * 100}%;background:${corUnidade(u.unidade)}"></span></span>
        <span class="val">${brlCurto(u.custoTotal)}</span></div>`).join('') : '<div class="vazio">Sem dados para esta seleção</div>';
    $$('#barUnidades .barra').forEach(b => b.addEventListener('click', e => selecionar('unidade', [b.dataset.v], multiClique(e))));
  }

  // ---------- ajustes: posicionar unidade no mapa ----------
  function renderAjusteMapa() {
    const sel = $('#ajMapaUnidade');
    const unidades = [...new Set([...Object.keys(D.LOCAL_UNIDADES), ...Object.keys(st.base.ajustes.localUnidade || {}), ...st.ctx.abast.map(a => a.unidade), ...st.ctx.multas.map(m => m.unidade), ...st.base.frota.map(f => f.unidade)])]
      .filter(u => u && u !== D.SEM_UNIDADE).sort();
    const atual = sel.value || unidades.find(u => !localUnidade(u)) || unidades[0] || '';
    sel.innerHTML = unidades.map(u => `<option ${u === atual ? 'selected' : ''} value="${esc(u)}">${esc(u)}${localUnidade(u) ? '' : ' (sem local)'}</option>`).join('');
    const loc = localUnidade(atual);
    $('#ajMapaInfo').textContent = loc ? `Local atual: ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)} · clique no mapa para mudar` : 'Ainda sem local · clique no mapa onde a unidade fica';
    const el = $('#mapaAjuste');
    el.innerHTML = svgMapa({ bolhas: unidades.filter(localUnidade).map(u => ({ unidade: u, valor: 1 })), ajuste: true, selUnid: new Set([atual]) });
    ligarDicas(el);
    const svg = el.querySelector('svg');
    svg.addEventListener('click', e => {
      const u = sel.value; if (!u) return;
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      const lon = +(p.x / (MAPA.C * MAPA.K) + MAPA.LON0).toFixed(3), lat = +(MAPA.LAT1 - p.y / MAPA.K).toFixed(3);
      alterar(b => { b.ajustes.localUnidade = b.ajustes.localUnidade || {}; b.ajustes.localUnidade[u] = { lat, lon }; }, `Ajuste: local da unidade ${u} no mapa`);
    });
    sel.onchange = () => renderAjusteMapa();
    const proprios = Object.entries(st.base.ajustes.localUnidade || {}).sort();
    $('#listaMapa').innerHTML = proprios.length ? proprios.map(([u, l]) => `<div><span><b>${esc(u)}</b> → ${l.lat.toFixed(2)}, ${l.lon.toFixed(2)}</span><button class="x" data-del-mapa="${esc(u)}" title="Voltar ao padrão">×</button></div>`).join('') : '<p class="sub">Usando os locais padrão das unidades.</p>';
    $$('[data-del-mapa]').forEach(b => b.onclick = () => alterar(base => { delete base.ajustes.localUnidade[b.dataset.delMapa]; }, `Ajuste: local padrão para ${b.dataset.delMapa}`));
  }

  // ---------- apresentação semanal ----------
  const apr = { off: 0, atual: 0, total: 0 };
  function semana(off) { const seg = addDias(semanaDe(ultimaData()), 7 * off); return { de: seg, ate: addDias(seg, 6) }; }
  const curto = iso => dBR(iso).slice(0, 5);
  function sDelta(atual, ant, menorMelhor = true, fmt = v => pct(Math.abs(v))) {
    if (atual == null || ant == null || !ant) return '';
    const v = atual / ant - 1;
    if (Math.abs(v) < 0.005) return '<span class="s-delta">= estável</span>';
    const ruim = menorMelhor ? v > 0 : v < 0;
    return `<span class="s-delta ${ruim ? 'sobe' : 'desce'}">${v > 0 ? '▲' : '▼'} ${fmt(v)}</span>`;
  }
  function sBarras(itens, fmt = brlCurto, cor = () => css('--accent')) {
    const max = Math.max(0, ...itens.map(i => i.valor)) || 1;
    return `<div class="s-barras">${itens.map(i => `<div class="s-barra"><span class="n" title="${esc(i.nome)}">${esc(i.nome)}</span><span class="t"><span style="width:${(i.valor / max) * 100}%;background:${cor(i)}"></span></span><span class="v">${fmt(i.valor)} ${i.extra || ''}</span></div>`).join('')}</div>`;
  }

  function renderApresentacao() {
    const w = semana(apr.off), wa = semana(apr.off - 1);
    const fim = ultimaData();
    const parcial = w.ate > fim;
    $('#aprSemana').textContent = `${curto(w.de)} a ${dBR(w.ate)}${parcial ? ' (parcial)' : ''}`;
    $('#aprProx').disabled = apr.off >= 0;
    const S = D.filtrar(st.ctx, w), A = D.filtrar(st.ctx, wa);
    const I = D.indicadores(S.ab, S.mu), IA = (A.ab.length || A.mu.length) ? D.indicadores(A.ab, A.mu) : null;
    const periodo = `Semana de ${curto(w.de)} a ${dBR(w.ate)}${parcial ? ` · dados até ${dBR(fim)}` : ''}`;
    const slides = [];
    const slide = (titulo, corpo, classe = '') => slides.push({ titulo, corpo, classe });

    // 1. resumo
    const k = (rot, val, sub, delta, cls = '') => `<div class="s-kpi ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${delta || ''} ${sub}</div></div>`;
    slide('Resumo da semana', `
      ${k('Custo total', brl(I.custoTotal), IA ? 'vs semana anterior' : '', IA && sDelta(I.custoTotal, IA.custoTotal), 'destaque')}
      ${k('Diesel', brl(I.custoDiesel), `${fNum(I.litrosDiesel)} litros`, IA && sDelta(I.custoDiesel, IA.custoDiesel))}
      ${k('Multas', brl(I.custoMultas), `${fNum(I.qtdMultas)} infrações`, IA && sDelta(I.custoMultas, IA.custoMultas))}
      ${k('Custo por km', I.rsKm == null ? '—' : fBRL3.format(I.rsKm), `${fNum(I.km)} km válidos`, IA && sDelta(I.rsKm, IA.rsKm))}
      ${k('Km por litro', fNum(I.kmL, 2), 'média do diesel', IA && sDelta(I.kmL, IA.kmL, false))}
      ${k('Preço do litro', I.rsLitro == null ? '—' : fBRL3.format(I.rsLitro), `Arla ${pct(I.arlaPct, 1)} do diesel`, IA && sDelta(I.rsLitro, IA.rsLitro))}`, 's-kpis');

    // 2. mapa + unidades
    const ufVal = new Map(); for (const a of S.ab) if (a.uf) ufVal.set(a.uf, (ufVal.get(a.uf) || 0) + a.valor);
    const U = D.porUnidade(S.ab, S.mu).filter(u => u.custoTotal > 0).sort((a, b) => b.custoTotal - a.custoTotal);
    const UA = new Map(D.porUnidade(A.ab, A.mu).map(u => [u.unidade, u]));
    const bolhas = U.filter(u => u.unidade !== D.SEM_UNIDADE).map(u => ({ unidade: u.unidade, valor: u.custoTotal }));
    slide('Onde gastamos', `<div class="s-bloco"><div class="s-mapa mapa">${svgMapa({ ufVal, bolhas, siglas: true })}</div></div>
      <div class="s-bloco"><h4>Custo por unidade · variação vs semana anterior</h4>${U.length ? sBarras(U.map(u => ({ nome: u.unidade, valor: u.custoTotal, extra: UA.get(u.unidade) ? sDelta(u.custoTotal, UA.get(u.unidade).custoTotal).replace('s-delta', 's-delta d') : '' })), brlCurto, i => corUnidade(i.nome)) : '<div class="s-vazio">Sem dados na semana</div>'}</div>`, 's-dois');

    // 3. eficiência por unidade
    slide('Eficiência por unidade', U.length ? `<div class="s-bloco"><table class="s-tabela"><thead><tr><th>Unidade</th><th class="dir">Custo total</th><th class="dir">vs anterior</th><th class="dir">Litros diesel</th><th class="dir">Km válidos</th><th class="dir">R$/km</th><th class="dir">km/L</th><th class="dir">Multas</th></tr></thead><tbody>${U.map(u => `<tr><td><span class="unid-cor" style="background:${corUnidade(u.unidade)}"></span><b>${esc(u.unidade)}</b></td><td class="dir num">${brl(u.custoTotal)}</td><td class="dir">${UA.get(u.unidade) ? sDelta(u.custoTotal, UA.get(u.unidade).custoTotal) : '<span class="s-delta">novo</span>'}</td><td class="dir num">${fNum(u.litrosDiesel)}</td><td class="dir num">${fNum(u.km)}</td><td class="dir">${chipVsMedia(u.rsKm, I.rsKm, true, v => fBRL3.format(v))}</td><td class="dir">${chipVsMedia(u.kmL, I.kmL, false, v => fNum(v, 2))}</td><td class="dir num">${u.qtdMultas ? brl(u.custoMultas) : '—'}</td></tr>`).join('')}</tbody></table><div class="slide-rodape"><span>Verde = melhor que a média da frota na semana · vermelho = pior</span></div></div>` : '<div class="s-vazio">Sem dados na semana</div>');

    // 4. postos e preços
    const dieselS = S.ab.filter(a => a.combustivel === 'DIESEL');
    const postos = [...D.agrupar(dieselS, a => a.posto + '|' + a.uf).entries()].map(([k2, l]) => { const [posto, uf] = k2.split('|'); const L = D.soma(l, a => a.litros), V = D.soma(l, a => a.valor); return { posto, uf, L, V, preco: L ? V / L : 0 }; }).filter(p => p.L > 0);
    const media = I.rsLitro || 0;
    const caros = [...postos].sort((a, b) => b.preco - a.preco).slice(0, 6);
    const porUF = [...D.agrupar(dieselS, a => a.uf || 'N/I').entries()].map(([uf, l]) => ({ nome: uf, valor: D.soma(l, a => a.valor) / (D.soma(l, a => a.litros) || 1) })).sort((a, b) => b.valor - a.valor);
    const aMais = D.soma(caros.filter(p => p.preco > media), p => (p.preco - media) * p.L);
    slide('Postos e preços do diesel', postos.length ? `<div class="s-bloco"><h4>Postos mais caros da semana · média da frota ${fBRL3.format(media)}</h4>
        <table class="s-tabela"><thead><tr><th>Posto</th><th>UF</th><th class="dir">Litros</th><th class="dir">R$/L</th><th class="dir">vs média</th></tr></thead><tbody>${caros.map(p => `<tr><td>${esc(p.posto)}</td><td>${esc(p.uf)}</td><td class="dir num">${fNum(p.L)}</td><td class="dir num"><b>${fBRL3.format(p.preco)}</b></td><td class="dir"><span class="s-delta ${p.preco > media ? 'sobe' : 'desce'}">${p.preco > media ? '+' : ''}${fBRL3.format(p.preco - media)}</span></td></tr>`).join('')}</tbody></table>
        <div class="slide-rodape"><span>Nesses postos, acima da média, pagou-se cerca de <b>${brl(aMais)}</b> a mais.</span></div></div>
      <div class="s-bloco"><h4>Preço médio do diesel por estado (R$/L)</h4>${sBarras(porUF, v => fBRL3.format(v), i => i.valor > media ? css('--s2') : css('--s3'))}</div>` : '<div class="s-vazio">Sem abastecimentos de diesel na semana</div>', 's-dois-iguais');

    // 5. veículos e motoristas
    const abc = D.curvaABC(D.porPlaca(S.ab, S.mu, st.ctx), p => p.custoDiesel).slice(0, 8);
    const mot = new Map(); for (const a of S.ab) mot.set(a.motorista || '(sem nome)', (mot.get(a.motorista || '(sem nome)') || 0) + a.valor); for (const m of S.mu) mot.set(m.motorista || '(sem nome)', (mot.get(m.motorista || '(sem nome)') || 0) + m.valor);
    const topMot = [...mot.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor).slice(0, 8);
    slide('Veículos e motoristas', `<div class="s-bloco"><h4>Veículos que mais gastaram com diesel</h4>${abc.length ? `<table class="s-tabela"><thead><tr><th>Placa</th><th>Unidade</th><th class="dir">Diesel</th><th class="dir">km/L</th></tr></thead><tbody>${abc.map(p => `<tr><td><span class="abc-badge abc-${p.classe}">${p.classe}</span> <b>${esc(p.placa)}</b></td><td>${esc(p.unidade)}</td><td class="dir num">${brl(p.custoDiesel)}</td><td class="dir">${chipVsMedia(p.kmL, I.kmL, false, v => fNum(v, 2))}</td></tr>`).join('')}</tbody></table>` : '<div class="s-vazio">Sem dados</div>'}</div>
      <div class="s-bloco"><h4>Motoristas que mais gastaram (combustível + multas)</h4>${topMot.length ? sBarras(topMot) : '<div class="s-vazio">Sem dados</div>'}</div>`, 's-dois-iguais');

    // 6. pontos de atenção
    const P = D.pontosAtencao(st.ctx, S.ab, S.mu);
    const it = [];
    const prazosAbertos = P.prazos.filter(p => !p.vencido);
    if (prazosAbertos.length) it.push(['crit', '⏰', `${prazosAbertos.length} prazos de multa nos próximos 10 dias`, prazosAbertos.slice(0, 5).map(p => `${dBR(p.prazo).slice(0, 5)}: ${p.oQue.toLowerCase()} · ${p.multa.placa} (${p.multa.unidade})`).join(' · ')]);
    if (P.kmInv.length) it.push(['warn', 'km', `${P.kmInv.length} abastecimentos com hodômetro inválido`, `Ficam fora do R$/km e do km/L. Placas: ${[...new Set(P.kmInv.map(a => a.placa))].slice(0, 8).join(', ')}`]);
    if (P.precoAlto.length) it.push(['info', 'R$', `${P.precoAlto.length} abastecimentos com diesel mais de 15% acima da média`, [...new Set(P.precoAlto.map(a => `${a.posto} (${a.uf})`))].slice(0, 4).join(' · ')]);
    if (I.arlaPct != null && (I.arlaPct < 0.04 || I.arlaPct > 0.07)) it.push(['warn', '%', `Arla em ${pct(I.arlaPct, 1)} do diesel`, 'O normal fica perto de 5%. Vale conferir se algum veículo está rodando sem Arla ou se há lançamento errado.']);
    if (P.placasSemUnidade.size) it.push(['crit', '!', `${P.placasSemUnidade.size} placas sem unidade`, [...P.placasSemUnidade.keys()].slice(0, 10).join(', ')]);
    if (P.multasSemUF.length) it.push(['warn', '?', `${P.multasSemUF.length} multas sem estado identificado`, 'Corrigir na aba Painel → Pontos de atenção.']);
    slide('Pontos de atenção', `<div class="s-lista">${it.length ? it.map(([c, ic, t, s]) => `<div class="s-item"><div class="ic ${c}">${ic}</div><div><b>${esc(t)}</b>${esc(s)}</div></div>`).join('') : '<div class="s-item"><div class="ic ok">✓</div><div><b>Tudo certo</b>Nenhum problema nos dados da semana.</div></div>'}</div>`);

    apr.total = slides.length;
    apr.atual = Math.min(apr.atual, apr.total - 1);
    const hoje = new Date().toLocaleDateString('pt-BR');
    $('#aprSlides').innerHTML = slides.map((s, i) => `<section class="slide ${i === apr.atual ? 'ativo' : ''}">
      <div class="slide-cab"><span class="num-slide">${i + 1}/${slides.length}</span><h2>${s.titulo}</h2><span class="periodo">${periodo}</span></div>
      <div class="slide-corpo ${s.classe}">${s.corpo}</div>
      <div class="slide-rodape"><span>Gold Frota</span><span>gerado em ${hoje}</span></div></section>`).join('');
    $('#aprPontos').innerHTML = slides.map((_, i) => `<button class="${i === apr.atual ? 'ativo' : ''}" data-i="${i}" aria-label="Tela ${i + 1}"></button>`).join('');
    $$('#aprPontos button').forEach(b => b.addEventListener('click', () => irSlide(+b.dataset.i)));
  }
  function irSlide(i) {
    apr.atual = Math.max(0, Math.min(apr.total - 1, i));
    $$('#aprSlides .slide').forEach((s, k) => s.classList.toggle('ativo', k === apr.atual));
    $$('#aprPontos button').forEach((b, k) => b.classList.toggle('ativo', k === apr.atual));
  }

  // ---------- mês: relatórios mensais do TruckPag ----------
  const NOME_MES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const rotMes = m => `${NOME_MES[+m.slice(5)]} de ${m.slice(0, 4)}`;
  const ordemMes = { col: 'valor', dir: -1 };
  function renderMes() {
    const R = st.base.resumos || { postos: {}, veiculos: {} };
    const meses = [...new Set([...Object.keys(R.postos || {}), ...Object.keys(R.veiculos || {})])].sort().reverse();
    $('#mesVazio').hidden = meses.length > 0;
    $('#mesConteudo').hidden = !meses.length;
    if (!meses.length) return;
    if (!st.mesAba || !meses.includes(st.mesAba)) st.mesAba = meses[0];
    $('#mesSel').innerHTML = meses.map(m => `<option value="${m}" ${m === st.mesAba ? 'selected' : ''}>${rotMes(m)}</option>`).join('');
    const P = R.postos?.[st.mesAba], V = R.veiculos?.[st.mesAba];
    $('#mesFontes').textContent = [P ? `Por posto: ${P.arquivo}` : 'Falta o consolidado por posto deste mês', V ? `Por veículo: ${V.arquivo}` : 'Falta a média por veículo deste mês'].join(' · ');

    // veículos com unidade (centro de custo do relatório → senão cadastro/ajuste)
    const veic = (V?.linhas || []).map(v => Object.assign({}, v, { unidade: v.unidade || st.ctx.unidadePlaca(v.placa) }));
    const unidades = [...new Set(veic.map(v => v.unidade))].sort();
    if (st.mesUnid && !unidades.includes(st.mesUnid)) st.mesUnid = '';
    $('#mesUnid').innerHTML = `<option value="">Todas</option>` + unidades.map(u => `<option ${u === st.mesUnid ? 'selected' : ''}>${esc(u)}</option>`).join('');
    const vf = st.mesUnid ? veic.filter(v => v.unidade === st.mesUnid) : veic;
    const postos = P?.linhas || [];

    // indicadores
    const totPostos = D.soma(postos, p => p.valor), dieselP = postos.filter(p => p.combustivel === 'DIESEL');
    const LdP = D.soma(dieselP, p => p.litros), VdP = D.soma(dieselP, p => p.valor), arlaP = D.soma(postos.filter(p => p.combustivel === 'ARLA'), p => p.valor);
    const totVeic = D.soma(vf, v => v.valor), litVeic = D.soma(vf, v => v.litros);
    const maior = [...vf].sort((a, b) => b.valor - a.valor)[0];
    $('#mesKpis').innerHTML = (st.mesUnid ? [
      kpi(`Gasto de ${esc(st.mesUnid)}`, brlCurto(totVeic), `${fNum(vf.length)} veículos · ${pct(totVeic / (D.soma(veic, v => v.valor) || 1))} da frota`, null, 'destaque'),
      kpi('Litros', fNum(litVeic), 'combustível + Arla'),
      kpi('Preço médio', litVeic ? fBRL3.format(totVeic / litVeic) : '—', 'por litro (todos os itens)'),
      kpi('Maior gasto', maior ? esc(maior.placa) : '—', maior ? brl(maior.valor) : ''),
      kpi('Média do maior', maior?.media ? fNum(maior.media, 2) + ' km/L' : '—', maior ? esc(maior.modelo) : ''),
      kpi('Veículos sem média', fNum(vf.filter(v => !v.media).length), 'sem km/L no relatório')
    ] : [
      kpi('Gasto do mês', brlCurto(P ? totPostos : totVeic), P ? `${fNum(D.soma(postos, p => p.transacoes))} abastecimentos · ${fNum(new Set(postos.map(p => p.posto)).size)} postos` : 'pelo relatório de médias', null, 'destaque'),
      kpi('Diesel', P ? brlCurto(VdP) : '—', P ? `${fNum(LdP)} litros` : ''),
      kpi('Preço médio do diesel', LdP ? fBRL3.format(VdP / LdP) : '—', 'por litro no mês'),
      kpi('Arla 32', P ? brlCurto(arlaP) : '—', P && VdP ? `${pct(arlaP / (VdP + arlaP), 1)} do gasto` : ''),
      kpi('Veículos', fNum(veic.length), V ? `${fNum(unidades.length)} unidades` : 'falta a média por veículo'),
      kpi('Maior gasto', maior ? esc(maior.placa) : '—', maior ? `${brl(maior.valor)} · ${esc(maior.unidade)}` : '')
    ]).join('');

    // maiores gastos por veículo
    const topV = [...vf].sort((a, b) => b.valor - a.valor).slice(0, 15);
    const maxV = topV[0]?.valor || 1;
    $('#mesVeicSub').textContent = st.mesUnid ? `Só ${st.mesUnid} · top ${topV.length}` : `Top ${topV.length} de ${veic.length} veículos · toque numa unidade (ao lado) para filtrar`;
    $('#mesVeic').innerHTML = topV.length ? topV.map(v => `<div class="barra" title="${esc(v.placa)} · ${esc(v.modelo)} · ${fNum(v.litros)} L${v.media ? ' · ' + fNum(v.media, 2) + ' km/L' : ''}">
      <span class="nome"><span class="unid-cor" style="background:${corUnidade(v.unidade)}"></span><b>${esc(v.placa)}</b> <small style="color:var(--text-3)">${esc(v.unidade)}</small></span>
      <span class="trilho"><span style="width:${(v.valor / maxV) * 100}%;background:${corUnidade(v.unidade)}"></span></span>
      <span class="val">${brl(v.valor)}</span></div>`).join('') : '<div class="vazio">Falta o relatório de médias deste mês</div>';

    // por unidade
    const porU = [...D.agrupar(veic, v => v.unidade).entries()].map(([u, l]) => ({ u, valor: D.soma(l, v => v.valor), n: l.length })).sort((a, b) => b.valor - a.valor);
    const maxU = porU[0]?.valor || 1, totU = D.soma(porU, x => x.valor) || 1;
    $('#mesUnidades').innerHTML = porU.length ? porU.map(x => `<div class="barra ${st.mesUnid ? (st.mesUnid === x.u ? 'marcado' : 'apagado') : ''}" data-u="${esc(x.u)}" title="${fNum(x.n)} veículos">
      <span class="nome"><span class="unid-cor" style="background:${corUnidade(x.u)}"></span>${esc(x.u)}</span>
      <span class="trilho"><span style="width:${(x.valor / maxU) * 100}%;background:${corUnidade(x.u)}"></span></span>
      <span class="val">${brlCurto(x.valor)} <small style="color:var(--text-3)">${pct(x.valor / totU)}</small></span></div>`).join('') : '<div class="vazio">Falta o relatório de médias deste mês</div>';
    $$('#mesUnidades .barra').forEach(b => b.addEventListener('click', () => { st.mesUnid = st.mesUnid === b.dataset.u ? '' : b.dataset.u; renderMes(); }));

    // mapa
    const ufVal = new Map(); for (const p of postos) if (p.uf) ufVal.set(p.uf, (ufVal.get(p.uf) || 0) + p.valor);
    const bolhas = porU.filter(x => x.u !== D.SEM_UNIDADE).map(x => ({ unidade: x.u, valor: x.valor }));
    const el = $('#mesMapa');
    el.innerHTML = svgMapa({ ufVal, bolhas, selUnid: new Set(st.mesUnid ? [st.mesUnid] : []) }) + legendaMapa(ufVal, bolhas.filter(b => !localUnidade(b.unidade)));
    ligarDicas(el);
    el.querySelectorAll('.bolha').forEach(g => g.addEventListener('click', () => { st.mesUnid = st.mesUnid === g.dataset.unidade ? '' : g.dataset.unidade; renderMes(); }));

    // por posto
    const porPosto = [...D.agrupar(postos, p => p.posto + '|' + p.uf).entries()].map(([k, l]) => { const [posto, uf] = k.split('|'); return { posto, uf, cidade: l[0].cidade, valor: D.soma(l, p => p.valor), tr: D.soma(l, p => p.transacoes) }; }).sort((a, b) => b.valor - a.valor);
    const topP = porPosto.slice(0, 12), maxP = topP[0]?.valor || 1;
    $('#mesPostos').innerHTML = topP.length ? topP.map(p => `<div class="barra" title="${esc(p.posto)} · ${esc(p.cidade)}/${esc(p.uf)} · ${fNum(p.tr)} abastecimentos">
      <span class="nome">${esc(p.posto.replace(/\s*[-|].*$/, '').slice(0, 34))} <small style="color:var(--text-3)">${esc(p.uf)}</small></span>
      <span class="trilho"><span style="width:${(p.valor / maxP) * 100}%;background:var(--s1)"></span></span>
      <span class="val">${brlCurto(p.valor)}</span></div>`).join('') : '<div class="vazio">Falta o consolidado por posto deste mês</div>';

    // diesel mais caro por posto
    const mediaD = LdP ? VdP / LdP : 0;
    const caros = dieselP.filter(p => p.litros > 0).map(p => ({ ...p, pl: p.valor / p.litros })).sort((a, b) => b.pl - a.pl).slice(0, 10);
    $('#mesPrecos').innerHTML = caros.length ? `<thead><tr><th>Posto</th><th>UF</th><th class="dir">Litros</th><th class="dir">R$/L</th><th class="dir">vs média</th><th class="dir">A mais</th></tr></thead><tbody>${caros.map(p => `<tr><td title="${esc(p.posto)}">${esc(p.posto.replace(/\s*[-|].*$/, '').slice(0, 30))}</td><td>${esc(p.uf)}</td><td class="dir num">${fNum(p.litros)}</td><td class="dir num"><b>${fBRL3.format(p.pl)}</b></td><td class="dir">${p.pl > mediaD ? `<span class="chip ruim">+${fBRL3.format(p.pl - mediaD)}</span>` : `<span class="chip bom">${fBRL3.format(p.pl - mediaD)}</span>`}</td><td class="dir num">${p.pl > mediaD ? brl((p.pl - mediaD) * p.litros) : '—'}</td></tr>`).join('')}</tbody>` : '<tr><td class="vazio">Falta o consolidado por posto deste mês</td></tr>';

    // conferência: relatórios × lançamentos do painel
    const [ano, mes] = st.mesAba.split('-').map(Number);
    const diasMes = new Date(ano, mes, 0).getDate();
    const lanc = st.ctx.abast.filter(a => a.data && a.data.startsWith(st.mesAba));
    const totLanc = D.soma(lanc, a => a.valor);
    const comDado = new Set(lanc.map(a => a.data));
    const faltam = []; let ini = null;
    for (let d = 1; d <= diasMes + 1; d++) {
      const iso = `${st.mesAba}-${pad2(d)}`, vazio = d <= diasMes && !comDado.has(iso) && iso <= D.isoDe(new Date());
      if (vazio && !ini) ini = d; if (!vazio && ini) { faltam.push(ini === d - 1 ? `${pad2(ini)}` : `${pad2(ini)} a ${pad2(d - 1)}`); ini = null; }
    }
    const base = P ? totPostos : totVeic;
    $('#mesConf').innerHTML = `<table><tbody>
      <tr><td>Consolidado por posto</td><td class="dir num"><b>${P ? brl(totPostos) : '—'}</b></td></tr>
      <tr><td>Média por veículo (soma)</td><td class="dir num"><b>${V ? brl(D.soma(veic, v => v.valor)) : '—'}</b></td></tr>
      <tr><td>Lançamentos importados no painel</td><td class="dir num"><b>${brl(totLanc)}</b> <small style="color:var(--text-3)">${base ? pct(totLanc / base) + ' do mês' : ''}</small></td></tr>
    </tbody></table>
    <p class="sub" style="margin-top:10px">${faltam.length ? `<b style="color:var(--critical)">Dias sem lançamentos no painel:</b> ${faltam.join(', ')}/${pad2(mes)}. Importe a fatura (CSV) desses dias para o painel por dia/placa ficar completo.` : 'Todos os dias do mês têm lançamentos no painel.'}</p>`;

    // tabela completa
    const cols = [['placa', 'Placa'], ['unidade', 'Unidade'], ['modelo', 'Modelo'], ['litros', 'Litros', 1], ['media', 'km/L', 1], ['ultimoKm', 'Último km', 1], ['valor', 'Valor', 1]];
    const lista = [...vf].sort((a, b) => { const x = a[ordemMes.col], y = b[ordemMes.col]; return typeof x === 'string' || typeof y === 'string' ? ordemMes.dir * String(x ?? '').localeCompare(String(y ?? '')) : ordemMes.dir * ((x ?? -Infinity) - (y ?? -Infinity)); });
    const medFrota = D.soma(veic.filter(v => v.media), v => v.media) / (veic.filter(v => v.media).length || 1);
    $('#mesTabela').innerHTML = `<thead><tr>${cols.map(([k, n, d]) => `<th data-c="${k}" class="${d ? 'dir' : ''}">${n}${ordemMes.col === k ? (ordemMes.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${lista.map(v => `<tr>
      <td><b>${esc(v.placa)}</b></td><td><span class="unid-cor" style="background:${corUnidade(v.unidade)}"></span>${esc(v.unidade)}</td><td style="color:var(--text-2)">${esc(v.modelo)}</td>
      <td class="dir num">${fNum(v.litros)}</td><td class="dir">${v.media ? chipVsMedia(v.media, medFrota, false, x => fNum(x, 2)) : `<span class="chip neutro" title="O relatório trouxe: ${esc(String(v.mediaInformada ?? '-'))}">—</span>`}</td>
      <td class="dir num">${fNum(v.ultimoKm)}</td><td class="dir num"><b>${brl(v.valor)}</b></td></tr>`).join('')}</tbody>`;
    $$('#mesTabela th').forEach(th => th.addEventListener('click', () => { const c = th.dataset.c; ordemMes.dir = ordemMes.col === c ? -ordemMes.dir : (['placa', 'unidade', 'modelo'].includes(c) ? 1 : -1); ordemMes.col = c; renderMes(); }));
  }
  const pad2 = n => String(n).padStart(2, '0');

  // ---------- relatório por unidade (PDF e Excel) ----------
  const rel = { de: '', ate: '', unidade: '' };
  const TODAS = '__todas__';
  function relSecoes() { return new Set($$('#relSecoes input:checked').map(i => i.value)); }
  function relAtalho(tipo) {
    const fim = ultimaData();
    if (tipo === 'semana') { const seg = addDias(semanaDe(fim), -7); rel.de = seg; rel.ate = addDias(seg, 6); }
    if (tipo === 'mes') { const d = new Date(fim.slice(0, 7) + '-01T12:00:00'); d.setMonth(d.getMonth() - 1); rel.de = D.isoDe(d); const f = new Date(d); f.setMonth(f.getMonth() + 1); f.setDate(0); rel.ate = D.isoDe(f); }
    if (tipo === 'esteMes') { rel.de = fim.slice(0, 8) + '01'; rel.ate = fim; }
    if (tipo === '30') { rel.de = addDias(fim, -29); rel.ate = fim; }
    if (tipo === 'tudo') { const ds = st.base.abastecimentos.map(a => a.data).filter(Boolean).sort(); rel.de = ds[0] || fim; rel.ate = fim; }
    $('#relDe').value = rel.de; $('#relAte').value = rel.ate;
  }

  /** Calcula tudo de uma unidade (ou da frota inteira) num período. */
  function dadosRelatorio(unidade, de, ate) {
    const filtroU = x => !unidade || x.unidade === unidade;
    const P = D.filtrar(st.ctx, { de, ate });
    const ab = P.ab.filter(filtroU), mu = P.mu.filter(filtroU);
    const n = diasEntre(de, ate) + 1, antDe = addDias(de, -n), antAte = addDias(de, -1);
    const A = D.filtrar(st.ctx, { de: antDe, ate: antAte });
    const abA = A.ab.filter(filtroU), muA = A.mu.filter(filtroU);
    // só compara se a base cobre o período anterior inteiro (senão a variação sai falsa)
    const primeira = st.base.abastecimentos.reduce((m, a) => (a.data && (!m || a.data < m) ? a.data : m), '');
    const I = D.indicadores(ab, mu), IA = primeira && primeira <= antDe && (abA.length || muA.length) ? D.indicadores(abA, muA) : null;
    const veic = D.curvaABC(D.porPlaca(ab, mu, st.ctx), p => p.custoTotal);
    const semDiesel = D.porPlaca(ab, mu, st.ctx).filter(p => !veic.some(v => v.placa === p.placa));
    const mot = [...D.agrupar([...ab.map(a => ({ m: a.motorista || '(sem nome)', v: a.valor, t: 'c', l: a.litros, p: a.placa })), ...mu.map(m => ({ m: m.motorista || '(sem nome)', v: m.valor, t: 'm', p: m.placa }))], x => x.m).entries()]
      .map(([m, l]) => ({ motorista: m, comb: D.soma(l.filter(x => x.t === 'c'), x => x.v), multas: D.soma(l.filter(x => x.t === 'm'), x => x.v), qtdMultas: l.filter(x => x.t === 'm').length, abast: l.filter(x => x.t === 'c').length, placas: [...new Set(l.map(x => x.p))].join(', ') }))
      .map(x => Object.assign(x, { total: x.comb + x.multas })).sort((a, b) => b.total - a.total);
    const diesel = ab.filter(a => a.combustivel === 'DIESEL');
    const mediaL = I.rsLitro || 0;
    const postos = [...D.agrupar(ab, a => a.posto + '|' + a.uf).entries()].map(([k, l]) => {
      const [posto, uf] = k.split('|'); const ld = l.filter(a => a.combustivel === 'DIESEL'); const L = D.soma(ld, a => a.litros), Vd = D.soma(ld, a => a.valor);
      return { posto, uf, cidade: l[0].cidade, abast: l.filter(a => !a.estorno).length, litros: L, valor: D.soma(l, a => a.valor), precoDiesel: L ? Vd / L : null, aMais: L && Vd / L > mediaL ? (Vd / L - mediaL) * L : 0 };
    }).sort((a, b) => b.valor - a.valor);
    const atencao = D.pontosAtencao(st.ctx, ab, mu);
    const prazos = atencao.prazos.filter(p => filtroU(p.multa));
    return { unidade, de, ate, I, IA, antDe, antAte, ab, mu, veic: [...veic, ...semDiesel.map(p => Object.assign(p, { classe: '—' }))], mot, postos, atencao, prazos, diesel };
  }

  function htmlRelatorio(R, sec) {
    const titulo = R.unidade ? `Unidade ${esc(R.unidade)}` : 'Frota inteira';
    const dlt = (a, b, menorMelhor = true) => { if (a == null || b == null || !b) return ''; const v = a / b - 1; if (Math.abs(v) < .005) return 'estável'; const ruim = menorMelhor ? v > 0 : v < 0; return `<span class="${ruim ? 'sobe' : 'desce'}">${v > 0 ? '▲' : '▼'} ${pct(Math.abs(v))}</span>`; };
    const k = (r, v, d) => `<div class="rel-kpi"><div class="r">${r}</div><div class="v">${v}</div><div class="d">${d || '&nbsp;'}</div></div>`;
    const { I, IA } = R;
    const vs = IA ? ` vs ${dBR(R.antDe).slice(0, 5)}–${dBR(R.antAte).slice(0, 5)}` : '';
    let h = `<article class="rel-pag">
      <header class="rel-cab"><svg class="logo" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M2 16V7h11v9M13 10h4l4 4v2h-8"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>
        <div><h1>Relatório · ${titulo}</h1><div class="meta">Período: ${dBR(R.de)} a ${dBR(R.ate)}${IA ? ` · comparado com ${dBR(R.antDe)} a ${dBR(R.antAte)}` : ''}</div></div>
        <div class="marca">Gold Frota<small>gerado em ${new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</small></div></header>`;
    if (sec.has('resumo')) h += `<h2>Resumo</h2><div class="rel-kpis">
      ${k('Custo total', brl(I.custoTotal), IA ? dlt(I.custoTotal, IA.custoTotal) + vs : '')}
      ${k('Diesel', brl(I.custoDiesel), `${fNum(I.litrosDiesel)} litros ${IA ? '· ' + dlt(I.custoDiesel, IA.custoDiesel) : ''}`)}
      ${k('Arla 32', brl(I.custoArla), `${pct(I.arlaPct, 1)} do diesel (litros)`)}
      ${k('Multas', brl(I.custoMultas), `${fNum(I.qtdMultas)} infrações`)}
      ${k('Km rodados (válidos)', fNum(I.km), `${fNum(I.qtdKmInvalido)} de ${fNum(I.qtdDiesel)} com hodômetro inválido`)}
      ${k('Custo por km', I.rsKm == null ? '—' : fBRL3.format(I.rsKm), IA ? dlt(I.rsKm, IA.rsKm) : '')}
      ${k('Km por litro', fNum(I.kmL, 2), IA ? dlt(I.kmL, IA.kmL, false) : '')}
      ${k('Preço médio do diesel', I.rsLitro == null ? '—' : fBRL3.format(I.rsLitro), `${fNum(I.veiculos)} veículos · ${fNum(I.qtdAbast)} abastecimentos`)}
    </div>`;
    if (sec.has('veiculos')) h += `<h2>Veículos</h2>${R.veic.length ? `<table><thead><tr><th>Placa</th><th>Modelo</th><th class="dir">Litros diesel</th><th class="dir">Km válidos</th><th class="dir">km/L</th><th class="dir">R$/km</th><th class="dir">Combustível</th><th class="dir">Multas</th><th class="dir">Total</th><th class="dir">% acum.</th></tr></thead><tbody>
      ${R.veic.map(p => `<tr><td><b>${esc(p.placa)}</b>${R.unidade ? '' : ` <small>${esc(p.unidade)}</small>`}</td><td>${esc(p.modelo)}</td><td class="dir num">${fNum(p.litrosDiesel)}</td><td class="dir num">${fNum(p.km)}</td><td class="dir num ${p.kmL && I.kmL && p.kmL < I.kmL * 0.85 ? 'alerta' : ''}">${fNum(p.kmL, 2)}</td><td class="dir num">${p.rsKm == null ? '—' : fBRL3.format(p.rsKm)}</td><td class="dir num">${brl(p.custoDiesel + p.custoArla + p.custoOutros)}</td><td class="dir num">${p.custoMultas ? brl(p.custoMultas) : '—'}</td><td class="dir num"><b>${brl(p.custoTotal)}</b></td><td class="dir num">${p.acumulado != null ? pct(p.acumulado) : '—'}</td></tr>`).join('')}
      <tr class="total"><td colspan="2">Total (${fNum(R.veic.length)} veículos)</td><td class="dir num">${fNum(I.litrosDiesel)}</td><td class="dir num">${fNum(I.km)}</td><td class="dir num">${fNum(I.kmL, 2)}</td><td class="dir num">${I.rsKm == null ? '—' : fBRL3.format(I.rsKm)}</td><td class="dir num">${brl(I.custoDiesel + I.custoArla + I.custoOutros)}</td><td class="dir num">${brl(I.custoMultas)}</td><td class="dir num">${brl(I.custoTotal)}</td><td></td></tr></tbody></table>
      <p class="nota">Em vermelho: km/L mais de 15% abaixo da média do relatório (${fNum(I.kmL, 2)}).</p>` : '<p class="vazio-rel">Sem veículos no período.</p>'}`;
    if (sec.has('motoristas')) h += `<h2>Motoristas</h2>${R.mot.length ? `<table><thead><tr><th>Motorista</th><th>Placas</th><th class="dir">Abastecimentos</th><th class="dir">Combustível</th><th class="dir">Multas</th><th class="dir">Total</th></tr></thead><tbody>
      ${R.mot.map(m => `<tr><td>${esc(m.motorista)}</td><td>${esc(m.placas)}</td><td class="dir num">${fNum(m.abast)}</td><td class="dir num">${brl(m.comb)}</td><td class="dir num">${m.qtdMultas ? `${brl(m.multas)} (${m.qtdMultas})` : '—'}</td><td class="dir num"><b>${brl(m.total)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="vazio-rel">Sem motoristas no período.</p>'}`;
    if (sec.has('postos')) h += `<h2>Postos utilizados</h2>${R.postos.length ? `<table><thead><tr><th>Posto</th><th>Cidade/UF</th><th class="dir">Abast.</th><th class="dir">Litros diesel</th><th class="dir">R$/L diesel</th><th class="dir">Pago a mais*</th><th class="dir">Valor</th></tr></thead><tbody>
      ${R.postos.map(p => `<tr><td>${esc(p.posto.slice(0, 48))}</td><td>${esc(p.cidade)}/${esc(p.uf)}</td><td class="dir num">${fNum(p.abast)}</td><td class="dir num">${fNum(p.litros)}</td><td class="dir num ${p.precoDiesel && I.rsLitro && p.precoDiesel > I.rsLitro * 1.05 ? 'alerta' : ''}">${p.precoDiesel ? fBRL3.format(p.precoDiesel) : '—'}</td><td class="dir num">${p.aMais ? brl(p.aMais) : '—'}</td><td class="dir num"><b>${brl(p.valor)}</b></td></tr>`).join('')}</tbody></table>
      <p class="nota">* Diferença em relação ao preço médio do diesel do relatório (${I.rsLitro ? fBRL3.format(I.rsLitro) : '—'}).</p>` : '<p class="vazio-rel">Sem abastecimentos no período.</p>'}`;
    if (sec.has('multas')) {
      h += `<h2>Multas</h2>${R.mu.length ? `<table><thead><tr><th>Data</th><th>Placa</th><th>Auto</th><th>Infração</th><th>Local</th><th>UF</th><th class="dir">Valor</th></tr></thead><tbody>
        ${[...R.mu].sort((a, b) => String(a.data).localeCompare(String(b.data))).map(m => `<tr><td>${dBR(m.data)}</td><td>${esc(m.placa)}</td><td>${esc(m.numero)}</td><td style="white-space:normal">${esc(m.tipo).slice(0, 80)}</td><td style="white-space:normal">${esc(m.local).slice(0, 50)}</td><td>${esc(m.ufCalc)}</td><td class="dir num">${brl(m.valor)}</td></tr>`).join('')}
        <tr class="total"><td colspan="6">Total (${fNum(R.mu.length)} multas)</td><td class="dir num">${brl(I.custoMultas)}</td></tr></tbody></table>` : '<p class="vazio-rel">Nenhuma multa no período.</p>'}`;
      if (R.prazos.length) h += `<p class="nota"><b class="alerta">Prazos:</b> ${R.prazos.map(p => `${dBR(p.prazo)} – ${p.oQue.toLowerCase()} (${esc(p.multa.placa)}, auto ${esc(p.multa.numero)})${p.vencido ? ' — vencido' : ''}`).join('; ')}</p>`;
    }
    if (sec.has('atencao')) {
      const A = R.atencao, it = [];
      if (A.kmInv.length) it.push(`<b>${A.kmInv.length} abastecimentos com hodômetro inválido</b> (fora do R$/km e km/L): ${[...new Set(A.kmInv.map(a => a.placa))].join(', ')}.`);
      if (A.precoAlto.length) it.push(`<b>${A.precoAlto.length} abastecimentos com diesel mais de 15% acima da média</b>: ${[...new Set(A.precoAlto.map(a => `${a.posto.slice(0, 30)} (${a.uf})`))].slice(0, 5).join('; ')}.`);
      if (I.arlaPct != null && I.qtdDiesel && (I.arlaPct < 0.04 || I.arlaPct > 0.07)) it.push(`<b>Arla em ${pct(I.arlaPct, 1)} do diesel</b> — o normal fica perto de 5%.`);
      if (A.placasSemUnidade.size) it.push(`<b>Placas sem unidade:</b> ${[...A.placasSemUnidade.keys()].join(', ')}.`);
      if (A.multasSemUF.length) it.push(`<b>${A.multasSemUF.length} multas sem estado identificado.</b>`);
      const piores = R.veic.filter(p => p.kmL && I.kmL && p.kmL < I.kmL * 0.85).map(p => `${p.placa} (${fNum(p.kmL, 2)} km/L)`);
      if (piores.length) it.push(`<b>Consumo acima do normal:</b> ${piores.join(', ')}.`);
      h += `<h2>Pontos de atenção</h2>${it.length ? `<ul>${it.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="vazio-rel">Nada a destacar no período.</p>'}`;
    }
    if (sec.has('lancamentos')) h += `<h2>Abastecimentos um a um</h2>${R.ab.length ? `<table><thead><tr><th>Data</th><th>Placa</th><th>Motorista</th><th>Posto</th><th>UF</th><th>Item</th><th class="dir">Litros</th><th class="dir">R$/L</th><th class="dir">Km</th><th class="dir">Valor</th></tr></thead><tbody>
      ${[...R.ab].sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora)).map(a => `<tr><td>${dBR(a.data)}</td><td>${esc(a.placa)}</td><td>${esc(a.motorista).slice(0, 28)}</td><td>${esc(a.posto).slice(0, 30)}</td><td>${esc(a.uf)}</td><td>${esc(a.combustivelNome)}</td><td class="dir num">${fNum(a.litros, 1)}</td><td class="dir num">${a.preco == null ? '—' : fBRL3.format(a.preco)}</td><td class="dir num ${a.combustivel === 'DIESEL' && !a.kmValido && !a.estorno ? 'alerta' : ''}">${fNum(a.km)}</td><td class="dir num">${brl(a.valor)}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio-rel">Sem abastecimentos no período.</p>'}`;
    h += `<div class="rel-rodape"><span>Gold Frota · ${titulo}</span><span>${dBR(R.de)} a ${dBR(R.ate)}</span></div></article>`;
    return h;
  }

  function unidadesRelatorio() {
    return [...new Set([...st.ctx.abast.map(a => a.unidade), ...st.ctx.multas.map(m => m.unidade)])].filter(Boolean).sort();
  }
  function renderRelatorio() {
    if (!rel.de) relAtalho('mes');
    const us = unidadesRelatorio();
    const sel = $('#relUnidade');
    const atual = rel.unidade || sel.value || '';
    sel.innerHTML = `<option value="">Frota inteira</option><option value="${TODAS}">Todas as unidades (uma por página)</option>` + us.map(u => `<option ${u === atual ? 'selected' : ''}>${esc(u)}</option>`).join('');
    sel.value = atual;
    rel.unidade = atual;
    if (!rel.de || !rel.ate || rel.de > rel.ate) { $('#relDoc').innerHTML = '<div class="cartao vazio">Escolha um período válido.</div>'; return; }
    const sec = relSecoes();
    const lista = rel.unidade === TODAS ? us.map(u => dadosRelatorio(u, rel.de, rel.ate)).filter(R => R.ab.length || R.mu.length) : [dadosRelatorio(rel.unidade, rel.de, rel.ate)];
    $('#relInfo').textContent = rel.unidade === TODAS ? `${lista.length} unidades com movimento no período` : `${fNum(lista[0].ab.length)} abastecimentos e ${fNum(lista[0].mu.length)} multas no período`;
    $('#relDoc').innerHTML = lista.map(R => htmlRelatorio(R, sec)).join('') || '<div class="cartao vazio">Nenhuma unidade com movimento no período.</div>';
  }

  function excelRelatorio() {
    const us = unidadesRelatorio();
    const lista = rel.unidade === TODAS ? us.map(u => dadosRelatorio(u, rel.de, rel.ate)).filter(R => R.ab.length || R.mu.length) : [dadosRelatorio(rel.unidade, rel.de, rel.ate)];
    const sec = relSecoes();
    const wb = XLSX.utils.book_new();
    const add = (nome, cab, linhas, larg) => { const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]); ws['!cols'] = (larg || cab.map(() => 14)).map(w => ({ wch: w })); ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: linhas.length, c: cab.length - 1 } }) }; XLSX.utils.book_append_sheet(wb, ws, nome); };
    const r2 = v => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
    const r3 = v => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);
    const U = R => R.unidade || 'FROTA INTEIRA';
    if (sec.has('resumo')) add('Resumo', ['Unidade', 'De', 'Até', 'Custo total', 'Diesel', 'Litros diesel', 'Arla', 'Multas', 'Qtd multas', 'Km válidos', 'R$/km', 'km/L', 'R$/L diesel', 'Veículos', 'Abastecimentos', 'Custo total período anterior', 'Variação %'],
      lista.map(R => [U(R), dBR(R.de), dBR(R.ate), r2(R.I.custoTotal), r2(R.I.custoDiesel), r2(R.I.litrosDiesel), r2(R.I.custoArla), r2(R.I.custoMultas), R.I.qtdMultas, R.I.km, r3(R.I.rsKm), r2(R.I.kmL), r3(R.I.rsLitro), R.I.veiculos, R.I.qtdAbast, R.IA ? r2(R.IA.custoTotal) : null, R.IA && R.IA.custoTotal ? r2((R.I.custoTotal / R.IA.custoTotal - 1) * 100) : null]), [18, 11, 11, 13, 13, 12, 10, 10, 9, 10, 8, 7, 9, 9, 13, 16, 10]);
    if (sec.has('veiculos')) add('Veículos', ['Unidade', 'Placa', 'Modelo', 'Litros diesel', 'Km válidos', 'km/L', 'R$/km', 'Combustível', 'Multas', 'Total'],
      lista.flatMap(R => R.veic.map(p => [p.unidade, p.placa, p.modelo, r2(p.litrosDiesel), p.km, r2(p.kmL), r3(p.rsKm), r2(p.custoDiesel + p.custoArla + p.custoOutros), r2(p.custoMultas), r2(p.custoTotal)])), [16, 10, 22, 12, 10, 7, 8, 12, 10, 12]);
    if (sec.has('motoristas')) add('Motoristas', ['Unidade', 'Motorista', 'Placas', 'Abastecimentos', 'Combustível', 'Multas', 'Qtd multas', 'Total'],
      lista.flatMap(R => R.mot.map(m => [U(R), m.motorista, m.placas, m.abast, r2(m.comb), r2(m.multas), m.qtdMultas, r2(m.total)])), [16, 32, 22, 13, 12, 10, 9, 12]);
    if (sec.has('postos')) add('Postos', ['Unidade', 'Posto', 'Cidade', 'UF', 'Abastecimentos', 'Litros diesel', 'R$/L diesel', 'Pago a mais vs média', 'Valor'],
      lista.flatMap(R => R.postos.map(p => [U(R), p.posto, p.cidade, p.uf, p.abast, r2(p.litros), r3(p.precoDiesel), r2(p.aMais), r2(p.valor)])), [16, 44, 16, 5, 13, 12, 10, 16, 12]);
    if (sec.has('multas')) add('Multas', ['Unidade', 'Data', 'Placa', 'Auto', 'Infração', 'Local', 'UF', 'Órgão', 'Valor', 'Prazo condutor', 'Prazo defesa'],
      lista.flatMap(R => R.mu.map(m => [m.unidade, dBR(m.data), m.placa, m.numero, m.tipo, m.local, m.ufCalc, m.orgao, r2(m.valor), dBR(m.prazoCondutor), dBR(m.prazoDefesa)])), [16, 11, 10, 13, 40, 36, 5, 24, 10, 13, 12]);
    if (sec.has('lancamentos')) add('Abastecimentos', ['Unidade', 'Data', 'Hora', 'Placa', 'Motorista', 'Posto', 'Cidade', 'UF', 'Item', 'Litros', 'R$/L', 'Km', 'Km válido', 'Valor', 'Transação'],
      lista.flatMap(R => R.ab.map(a => [a.unidade, dBR(a.data), a.hora, a.placa, a.motorista, a.posto, a.cidade, a.uf, a.combustivelNome, r2(a.litros), r3(a.preco), a.km, a.kmValido ? 'Sim' : 'Não', r2(a.valor), a.id])), [16, 11, 6, 10, 30, 36, 16, 5, 16, 9, 8, 8, 9, 11, 12]);
    if (!wb.SheetNames.length) { toast('Marque pelo menos uma informação para incluir'); return; }
    const nomeU = rel.unidade === TODAS ? 'todas as unidades' : (rel.unidade || 'frota inteira');
    XLSX.writeFile(wb, `Relatório Gold Frota - ${nomeU} - ${dBR(rel.de).replace(/\//g, '-')} a ${dBR(rel.ate).replace(/\//g, '-')}.xlsx`);
    toast('Excel gerado (pasta Downloads)');
  }

  // ---------- gravação segura ----------
  async function alterar(mudanca, mensagem) {
    if (!st.podeEditar) { toast(st.servidor ? 'Somente visualização: alterações só no computador do responsável.' : 'Somente visualização.'); return false; }
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
        const r = await D.lerArquivo(f.name, buf);
        const copia = await D.guardarArquivo(f.name, buf);
        lidos.push({ nome: f.name, tipo: r.tipo, formato: r.formato, registros: r.registros, mes: r.mes, periodo: r.periodo, copia });
      } catch (e) { lidos.push({ nome: f.name, erro: e.message }); }
    }
    const validos = lidos.filter(l => !l.erro);
    let git = null;
    if (validos.length) {
      const ok = await alterar(base => {
        for (const l of validos) {
          let m;
          if (l.tipo === 'resumoPostos' || l.tipo === 'resumoVeiculos') {
            // relatório mensal: guarda à parte, um por mês; importar de novo o mesmo mês substitui (a versão antiga fica no git)
            const chave = l.tipo === 'resumoPostos' ? 'postos' : 'veiculos';
            base.resumos = base.resumos || { postos: {}, veiculos: {} };
            base.resumos[chave] = base.resumos[chave] || {};
            const existia = !!base.resumos[chave][l.mes];
            base.resumos[chave][l.mes] = { arquivo: l.nome, importado: new Date().toISOString(), periodo: l.periodo || null, linhas: l.registros };
            m = { novos: existia ? 0 : l.registros.length, atualizados: existia ? l.registros.length : 0, iguais: 0 };
            st.mesAba = l.mes;
          } else m = D.mesclar(base, l.tipo, l.registros);
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
      : `<div class="res-item"><div class="at-icone info" style="color:var(--good-text)">✓</div><div class="at-txt"><b>${esc(l.nome)} · ${esc(l.formato || nomeTipo[l.tipo])}</b><span>${fNum(l.registros.length)} lidos · <b>${fNum(l.novos)} novos</b> · ${fNum(l.atualizados)} atualizados · ${fNum(l.iguais)} já existiam</span></div></div>`).join('');
    if (git) renderImportar();
  }

  function renderImportar() {
    const b = st.base, r = b.resumo || {};
    const datas = b.abastecimentos.map(a => a.data).filter(Boolean).sort();
    const datasM = b.multas.map(a => a.data).filter(Boolean).sort();
    $('#resumoBase').innerHTML = `<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin:0">
      ${kpi('Abastecimentos', fNum(b.abastecimentos.length), datas.length ? `${dBR(datas[0])} a ${dBR(datas.at(-1))}` : 'nenhum ainda')}
      ${kpi('Multas', fNum(b.multas.length), datasM.length ? `${dBR(datasM[0])} a ${dBR(datasM.at(-1))}` : 'nenhuma ainda')}
      ${kpi('Veículos', fNum(b.frota.filter(f => D.placaValida(f.placa)).length), 'no cadastro')}</div>
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
      lista: () => st.base.frota.filter(f => D.placaValida(f.placa)).map(f => Object.assign({}, f, { unidadeFinal: st.ctx.unidadePlaca(f.placa) })),
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
  /** Gera um único .html, somente visualização, com o painel e os dados de agora embutidos. */
  async function htmlVisualizacao(quando = new Date()) {
    const txt = u => fetch(u, { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(u); return r.text(); });
    const [pagina, cssTxt, mapaJs, dadosJs, appJs] = await Promise.all(['index.html', 'assets/style.css', 'assets/mapa-brasil.js', 'assets/data.js', 'assets/app.js'].map(txt));
    const seguro = s => s.replace(/<\/(script)/gi, '<\\/$1');
    let html = pagina
      .replace('<title>Gold Frota</title>', () => '<title>Gold Frota · visualização</title>')
      .replace('<link rel="stylesheet" href="assets/style.css">', () => `<style>\n${cssTxt}\n</style>`)
      .replace('<script src="assets/mapa-brasil.js"></script>', () => `<script>${seguro(mapaJs)}</script>\n<script>window.SOMENTE_LEITURA = true; window.GERADO_EM = ${JSON.stringify(quando.toISOString())}; window.BASE_EMBUTIDA = ${seguro(JSON.stringify(st.base))};</script>`)
      .replace('<script src="assets/data.js"></script>', () => `<script>${seguro(dadosJs)}</script>`)
      .replace('<script src="assets/app.js"></script>', () => `<script>${seguro(appJs)}</script>`);
    if (!html.includes('BASE_EMBUTIDA')) throw new Error('modelo da página mudou');
    return html;
  }
  async function exportarVisualizacao() {
    const quando = new Date();
    const html = await htmlVisualizacao(quando);
    baixar(new Blob([html], { type: 'text/html;charset=utf-8' }), `Gold Frota - visualizacao - ${D.isoDe(quando)}.html`);
    toast('Arquivo gerado (pasta Downloads). Quem abrir só visualiza: não altera os seus dados.', 6000);
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
    if (st.site) return set('ok', 'Atualizado em ' + (st.base.resumo?.atualizado ? new Date(st.base.resumo.atualizado).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'), 'Somente visualização. Os dados são atualizados a partir do computador do responsável.');
    if (st.embutida) return set('ok', 'Somente visualização', 'Arquivo gerado em ' + new Date(window.GERADO_EM || Date.now()).toLocaleString('pt-BR') + '. Os dados não podem ser alterados aqui.');
    if (st.servidor && !st.podeEditar) return set('alerta', 'Somente visualização', 'Alterações só podem ser feitas no computador do responsável pelo painel.');
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
    renderAjusteMapa();
    if ($('#tela-apresentacao').classList.contains('ativa')) renderApresentacao();
    if ($('#tela-mes').classList.contains('ativa')) renderMes();
    if ($('#tela-relatorio').classList.contains('ativa')) renderRelatorio();
  }

  function ligar() {
    $$('#abas .aba').forEach(b => b.addEventListener('click', () => {
      $$('#abas .aba').forEach(x => x.classList.toggle('ativa', x === b));
      $$('.tela').forEach(t => t.classList.toggle('ativa', t.id === 'tela-' + b.dataset.tela));
      if (b.dataset.tela === 'dados') renderDados();
      if (b.dataset.tela === 'painel') renderPainel();
      if (b.dataset.tela === 'apresentacao') renderApresentacao();
      if (b.dataset.tela === 'ajustes') renderAjusteMapa();
      if (b.dataset.tela === 'mes') renderMes();
      if (b.dataset.tela === 'relatorio') renderRelatorio();
    }));
    // relatório por unidade
    $('#relUnidade').addEventListener('change', e => { rel.unidade = e.target.value; renderRelatorio(); });
    $('#relDe').addEventListener('change', e => { rel.de = e.target.value; renderRelatorio(); });
    $('#relAte').addEventListener('change', e => { rel.ate = e.target.value; renderRelatorio(); });
    $$('#relAtalhos button').forEach(b => b.addEventListener('click', () => { relAtalho(b.dataset.r); renderRelatorio(); }));
    $$('#relSecoes input').forEach(i => i.addEventListener('change', renderRelatorio));
    $('#relPDF').addEventListener('click', () => {
      renderRelatorio();
      document.body.classList.add('print-rel');
      toast('Na janela que abrir, escolha "Salvar como PDF"', 5000);
      setTimeout(() => { window.print(); document.body.classList.remove('print-rel'); }, 300);
    });
    $('#relExcel').addEventListener('click', () => { try { excelRelatorio(); } catch (e) { toast('Não consegui gerar o Excel: ' + e.message, 6000); } });
    // mês
    $('#mesSel').addEventListener('change', e => { st.mesAba = e.target.value; st.mesUnid = ''; renderMes(); });
    $('#mesUnid').addEventListener('change', e => { st.mesUnid = e.target.value; renderMes(); });
    // semana no painel
    $('#semAnt').addEventListener('click', () => { st.filtro.semOff--; st.sel.periodo.clear(); renderPainel(); });
    $('#semProx').addEventListener('click', () => { if (st.filtro.semOff < 0) { st.filtro.semOff++; st.sel.periodo.clear(); renderPainel(); } });
    // apresentação
    $('#aprAnt').addEventListener('click', () => { apr.off--; renderApresentacao(); });
    $('#aprProx').addEventListener('click', () => { if (apr.off < 0) { apr.off++; renderApresentacao(); } });
    $('#aprVolta').addEventListener('click', () => irSlide(apr.atual - 1));
    $('#aprAvanca').addEventListener('click', () => irSlide(apr.atual + 1));
    $('#aprTela').addEventListener('click', () => {
      const p = $('#aprPalco');
      (p.requestFullscreen ? p.requestFullscreen() : Promise.reject()).catch(() => toast('O navegador não permitiu tela cheia'));
    });
    $('#aprPDF').addEventListener('click', () => { renderApresentacao(); toast('Na janela que abrir, escolha "Salvar como PDF"', 5000); setTimeout(() => window.print(), 300); });
    $('#aprArquivo').addEventListener('click', () => exportarVisualizacao().catch(e => toast('Não consegui gerar o arquivo: ' + e.message, 6000)));
    $('#aprSlides').addEventListener('click', e => { if (document.fullscreenElement && !e.target.closest('button, a')) irSlide(apr.atual + 1); });
    document.addEventListener('keydown', e => {
      if (!$('#tela-apresentacao').classList.contains('ativa') || (e.target.closest && e.target.closest('input, select, textarea'))) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); irSlide(apr.atual + 1); }
      if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); irSlide(apr.atual - 1); }
      if (e.key === 'Home') irSlide(0);
      if (e.key === 'End') irSlide(apr.total - 1);
    });
    // tela cheia do painel (TV)
    $('#btnTV').addEventListener('click', () => {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      document.documentElement.requestFullscreen().then(() => { document.body.classList.add('tv'); renderPainel(); }).catch(() => toast('O navegador não permitiu tela cheia'));
    });
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && document.body.classList.contains('tv')) { document.body.classList.remove('tv'); renderPainel(); }
    });
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
      if (e.key !== 'Escape' || document.fullscreenElement) return;
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
      renderAjusteMapa();
      if ($('#tela-apresentacao').classList.contains('ativa')) renderApresentacao();
      if ($('#tela-mes').classList.contains('ativa')) renderMes();
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
    st.embutida = origem === 'embutida' || origem === 'site';
    st.site = origem === 'site';
    // só edita quem está no computador do servidor; arquivo exportado e acesso pela rede só visualizam
    st.podeEditar = st.servidor ? ((await D.statusGit()) || {}).podeEditar !== false : false;
    document.body.classList.toggle('so-leitura', !st.podeEditar);
    $('#avisoServidor').classList.toggle('mostra', !st.servidor && !st.embutida);
    recalcular();
    mostrarGit();
    if (st.podeEditar && !st.base.abastecimentos.length && !st.base.multas.length) {
      $$('#abas .aba')[1].click();
      toast('Comece importando as planilhas', 4000);
    }
  }

  // Para testes no console: App.importarBuffer(nome, arrayBuffer)
  window.App = { estado: st, selecionar, limparTudo, htmlVisualizacao, importarBuffer: (nome, buf) => importar([new File([buf], nome)]) };
  if (!window.XLSX || !window.Chart) { document.body.insertAdjacentHTML('afterbegin', '<div class="aviso mostra" style="margin:16px">Não consegui carregar as bibliotecas (sem internet?). O painel precisa de internet para abrir os gráficos e ler as planilhas.</div>'); }
  else iniciar();
})();
