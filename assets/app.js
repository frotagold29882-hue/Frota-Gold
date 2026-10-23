/* Painel da Frota — interface */
(function () {
  'use strict';
  const D = window.Dados;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const st = {
    base: D.baseVazia(), ctx: null, servidor: false,
    filtro: { p: '30', de: '', ate: '', unidade: '', uf: '' },
    graficos: {}, coresUnidade: new Map(), dadosAba: 'abastecimentos', ordem: { col: 'custoTotal', dir: -1 }
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
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];

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
    // só compara se a base cobre o período anterior inteiro
    let primeira = '';
    for (const a of st.base.abastecimentos) if (a.data && (!primeira || a.data < primeira)) primeira = a.data;
    return primeira && primeira <= ant.de ? ant : null;
  }

  // ---------- cores estáveis por unidade (a cor segue a unidade, não a posição) ----------
  function definirCores() {
    const tot = new Map();
    for (const a of st.ctx.abast) tot.set(a.unidade, (tot.get(a.unidade) || 0) + a.valor);
    for (const m of st.ctx.multas) tot.set(m.unidade, (tot.get(m.unidade) || 0) + m.valor);
    const lista = [...tot.entries()].filter(([u]) => u !== D.SEM_UNIDADE).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    st.coresUnidade = new Map(lista.slice(0, 8).map(([u], i) => [u, SERIES[i]]));
  }
  const corUnidade = u => css(st.coresUnidade.get(u) || '--outros');

  // ---------- rosca reutilizável ----------
  function rosca(id, itens, opc = {}) {
    const el = document.getElementById(id);
    if (st.graficos[id]) { st.graficos[id].destroy(); delete st.graficos[id]; }
    itens = itens.filter(i => i.valor > 0);
    const total = itens.reduce((s, i) => s + i.valor, 0);
    if (!total) { el.innerHTML = `<div class="vazio">Sem dados no período</div>`; return; }
    const max = opc.max || 7;
    if (itens.length > max) {
      const resto = itens.slice(max - 1);
      itens = itens.slice(0, max - 1).concat([{ nome: 'Outros', valor: resto.reduce((s, i) => s + i.valor, 0), cor: css('--outros'), extra: `${resto.length} itens` }]);
    }
    const fmt = opc.fmt || brl, fmtLeg = opc.fmt || brlCurto;
    el.innerHTML = `<div class="rosca"><div class="rosca-graf"><canvas></canvas><div class="rosca-centro"><b class="num">${esc(opc.centro ?? brlCurto(total))}</b><span>${esc(opc.centroSub || 'total')}</span></div></div>
      <ul class="legenda">${itens.map((i, k) => `<li data-k="${k}" title="${esc(i.nome)}"><span class="cor" style="background:${i.cor}"></span><span class="nome">${esc(i.nome)}${i.extra ? ` <small style="color:var(--text-3)">· ${esc(i.extra)}</small>` : ''}</span><span class="val num">${fmtLeg(i.valor)}</span><span class="pct num">${pct(i.valor / total)}</span></li>`).join('')}</ul></div>`;
    const ch = new Chart(el.querySelector('canvas'), {
      type: 'doughnut',
      data: { labels: itens.map(i => i.nome), datasets: [{ data: itens.map(i => i.valor), backgroundColor: itens.map(i => i.cor), borderColor: css('--surface'), borderWidth: 2, hoverOffset: 6, borderRadius: 3 }] },
      options: {
        cutout: '70%', responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
        layout: { padding: 6 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${fmt(c.raw)} (${pct(c.raw / total, 1)})` } } },
        onClick: (e, els) => { if (els.length && opc.clique) opc.clique(itens[els[0].index]); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length && opc.clique ? 'pointer' : 'default'; }
      }
    });
    st.graficos[id] = ch;
    el.querySelectorAll('.legenda li').forEach(li => {
      const k = +li.dataset.k;
      li.addEventListener('mouseenter', () => { ch.setActiveElements([{ datasetIndex: 0, index: k }]); ch.tooltip.setActiveElements([{ datasetIndex: 0, index: k }], { x: 0, y: 0 }); ch.update(); });
      li.addEventListener('mouseleave', () => { ch.setActiveElements([]); ch.tooltip.setActiveElements([], { x: 0, y: 0 }); ch.update(); });
      if (opc.clique) li.addEventListener('click', () => opc.clique(itens[k]));
    });
  }

  // ---------- painel ----------
  function preencherFiltros() {
    const unidades = [...new Set([...st.ctx.abast.map(a => a.unidade), ...st.ctx.multas.map(m => m.unidade)])].sort();
    const ufs = [...new Set([...st.ctx.abast.map(a => a.uf), ...st.ctx.multas.map(m => m.ufCalc)].filter(Boolean))].sort();
    const sel = (el, vals, todos, atual) => { el.innerHTML = `<option value="">${todos}</option>` + vals.map(v => `<option ${v === atual ? 'selected' : ''}>${esc(v)}</option>`).join(''); };
    sel($('#fUnidade'), unidades, 'Todas', st.filtro.unidade);
    sel($('#fUF'), ufs, 'Todos', st.filtro.uf);
    $('#listaUnidades').innerHTML = unidades.filter(u => u !== D.SEM_UNIDADE).map(u => `<option value="${esc(u)}">`).join('');
  }

  function kpi(rot, val, sub, delta, cls = '') {
    let d = '';
    if (delta != null && isFinite(delta) && Math.abs(delta) >= 0.005) d = `<span class="delta ${delta > 0 ? 'sobe' : 'desce'}" title="vs. período anterior">${delta > 0 ? '▲' : '▼'} ${pct(Math.abs(delta))}</span>`;
    return `<div class="kpi ${cls}"><div class="kpi-rot">${rot}${d}</div><div class="kpi-val num">${val}</div><div class="kpi-sub">${sub}</div></div>`;
  }
  const variacao = (a, b) => (a == null || b == null || !b ? null : a / b - 1);

  function renderPainel() {
    const iv = intervalo();
    const f = Object.assign({}, st.filtro, iv);
    const { ab, mu } = D.filtrar(st.ctx, f);
    const I = D.indicadores(ab, mu);
    const ant = intervaloAnterior(iv);
    let P = null;
    if (ant) { const r = D.filtrar(st.ctx, Object.assign({}, st.filtro, ant)); if (r.ab.length || r.mu.length) P = D.indicadores(r.ab, r.mu); }

    $('#periodoTxt').textContent = (iv.de ? `${dBR(iv.de)} a ${dBR(iv.ate)}` : 'Todo o histórico') + (P ? ' · setas comparam com o período anterior' : '');
    $('#btnLimpar').hidden = !(st.filtro.unidade || st.filtro.uf);

    $('#kpis').innerHTML = [
      kpi('Custo total', brlCurto(I.custoTotal), `${fNum(I.veiculos)} veículos · ${fNum(I.qtdAbast)} abastecimentos`, P && variacao(I.custoTotal, P.custoTotal), 'destaque'),
      kpi('Diesel', brlCurto(I.custoDiesel), `${fNum(I.litrosDiesel)} litros`, P && variacao(I.custoDiesel, P.custoDiesel)),
      kpi('Multas', brlCurto(I.custoMultas), `${fNum(I.qtdMultas)} infrações`, P && variacao(I.custoMultas, P.custoMultas)),
      kpi('Custo por km', I.rsKm == null ? '—' : fBRL3.format(I.rsKm), `${fNum(I.km)} km válidos`, P && variacao(I.rsKm, P.rsKm)),
      kpi('Km por litro', fNum(I.kmL, 2), 'média do diesel', P && I.kmL && P.kmL ? -(I.kmL / P.kmL - 1) : null),
      kpi('Preço do litro', I.rsLitro == null ? '—' : fBRL3.format(I.rsLitro), `Arla: ${pct(I.arlaPct, 1)} do diesel`, P && variacao(I.rsLitro, P.rsLitro))
    ].join('');

    // composição
    rosca('rCompos', [
      { nome: 'Diesel', valor: I.custoDiesel, cor: css('--s1') },
      { nome: 'Multas', valor: I.custoMultas, cor: css('--s2') },
      { nome: 'Arla 32', valor: I.custoArla, cor: css('--s3') },
      { nome: 'Outros combustíveis', valor: I.custoOutros, cor: css('--s4') }
    ]);

    // por unidade
    const U = D.porUnidade(ab, mu);
    rosca('rUnidade', U.map(u => ({ nome: u.unidade, valor: u.custoTotal, cor: corUnidade(u.unidade) })).sort((a, b) => b.valor - a.valor),
      { centroSub: `${U.length} unidades`, clique: i => i.nome !== 'Outros' && filtrarUnidade(i.nome) });

    // por estado
    const gUF = D.agrupar(ab.filter(a => a.combustivel === 'DIESEL'), a => a.uf || 'N/I');
    const ufs = [...gUF.entries()].map(([uf, l]) => ({ nome: uf, valor: D.soma(l, a => a.valor), litros: D.soma(l, a => a.litros) })).sort((a, b) => b.valor - a.valor);
    rosca('rEstado', ufs.map((u, k) => ({ nome: D.NOMES_UF[u.nome] ? `${u.nome} · ${D.NOMES_UF[u.nome]}` : u.nome, uf: u.nome, valor: u.valor, cor: css(SERIES[k] || '--outros') })),
      { max: 6, centroSub: `${ufs.length} estados`, clique: i => i.uf && filtrarUF(i.uf) });

    // ABC
    const placas = D.porPlaca(ab, mu, st.ctx);
    const abc = D.curvaABC(placas, p => p.custoDiesel);
    const cls = c => abc.filter(x => x.classe === c);
    rosca('rABC', [
      { nome: `A · ${cls('A').length} veículos`, valor: D.soma(cls('A'), x => x.valorABC), cor: css('--s1') },
      { nome: `B · ${cls('B').length} veículos`, valor: D.soma(cls('B'), x => x.valorABC), cor: css('--s7') },
      { nome: `C · ${cls('C').length} veículos`, valor: D.soma(cls('C'), x => x.valorABC), cor: css('--outros') }
    ], { centro: fNum(abc.length), centroSub: 'veículos' });

    // multas
    const MU = U.filter(u => u.custoMultas > 0);
    $('#subMultas').textContent = `${fNum(I.qtdMultas)} infrações · valor cheio, pela data`;
    rosca('rMultas', MU.map(u => ({ nome: u.unidade, valor: u.custoMultas, cor: corUnidade(u.unidade), extra: fNum(u.qtdMultas) })).sort((a, b) => b.valor - a.valor),
      { clique: i => i.nome !== 'Outros' && filtrarUnidade(i.nome) });

    // eficiência
    rosca('rEfic', [
      { nome: 'Km válido', valor: I.qtdDiesel - I.qtdKmInvalido, cor: css('--s3') },
      { nome: 'Hodômetro com erro', valor: I.qtdKmInvalido, cor: css('--s2') }
    ], { fmt: v => fNum(v), centro: pct(I.qtdDiesel ? (I.qtdDiesel - I.qtdKmInvalido) / I.qtdDiesel : null), centroSub: 'dos abastecimentos' });
    if (I.qtdDiesel) $('#rEfic').insertAdjacentHTML('beforeend', `<div style="display:flex;gap:18px;margin-top:12px;font-size:12.5px;color:var(--text-2)"><span>R$/km <b class="num" style="color:var(--text)">${I.rsKm == null ? '—' : fBRL3.format(I.rsKm)}</b></span><span>km/L <b class="num" style="color:var(--text)">${fNum(I.kmL, 2)}</b></span><span>Arla <b class="num" style="color:var(--text)">${pct(I.arlaPct, 1)}</b></span></div>`);

    renderRanking(U, I);
    renderEvolucao(ab, mu);
    renderAtencao(ab, mu);
    renderTopPlacas(abc);
  }

  function filtrarUnidade(u) { st.filtro.unidade = st.filtro.unidade === u ? '' : u; preencherFiltros(); renderPainel(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function filtrarUF(uf) { st.filtro.uf = st.filtro.uf === uf ? '' : uf; preencherFiltros(); renderPainel(); }

  function chipVsMedia(v, media, menorMelhor, fmt) {
    if (v == null) return '<span class="chip neutro">—</span>';
    if (media == null) return `<span class="chip neutro">${fmt(v)}</span>`;
    const melhor = menorMelhor ? v <= media : v >= media;
    return `<span class="chip ${melhor ? 'bom' : 'ruim'}" title="Média da frota: ${fmt(media)}">${melhor ? '●' : '▲'} ${fmt(v)}</span>`;
  }

  function renderRanking(U, I) {
    const total = I.custoTotal || 1;
    const cols = [
      ['unidade', 'Unidade'], ['custoTotal', 'Participação', 1], ['custoDiesel', 'Diesel', 1], ['litrosDiesel', 'Litros', 1], ['km', 'Km válidos', 1],
      ['rsKm', 'R$/km', 1], ['kmL', 'km/L', 1], ['rsLitro', 'R$/litro', 1], ['qtdMultas', 'Multas', 1], ['custoMultas', 'R$ multas', 1]
    ];
    const { col, dir } = st.ordem;
    U.sort((a, b) => { const x = a[col], y = b[col]; if (typeof x === 'string') return dir * x.localeCompare(y); return dir * ((x ?? -Infinity) - (y ?? -Infinity)); });
    const t = $('#tabUnidades');
    if (!U.length) { t.innerHTML = `<tr><td class="vazio">Sem dados no período</td></tr>`; return; }
    t.innerHTML = `<thead><tr>${cols.map(([k, n, d]) => `<th data-c="${k}" class="${d ? 'dir' : ''}">${n}${col === k ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>${U.map(u => {
      const p = u.custoTotal / total, cor = corUnidade(u.unidade);
      return `<tr class="clicavel" data-u="${esc(u.unidade)}">
        <td><span class="unid-cor" style="background:${cor}"></span><b>${esc(u.unidade)}</b>${st.filtro.unidade === u.unidade ? ' <span class="chip neutro">filtrada</span>' : ''}</td>
        <td class="dir"><span class="cel-anel"><span class="num">${brl(u.custoTotal)}</span><span class="mini-anel" style="background:conic-gradient(${cor} ${p * 360}deg, var(--surface-2) 0)" title="${pct(p, 1)} do custo"></span><span class="num" style="width:38px;color:var(--text-3)">${pct(p)}</span></span></td>
        <td class="dir num">${brl(u.custoDiesel)}</td><td class="dir num">${fNum(u.litrosDiesel)}</td><td class="dir num">${fNum(u.km)}</td>
        <td class="dir">${chipVsMedia(u.rsKm, I.rsKm, true, v => fBRL3.format(v))}</td>
        <td class="dir">${chipVsMedia(u.kmL, I.kmL, false, v => fNum(v, 2))}</td>
        <td class="dir">${chipVsMedia(u.rsLitro, I.rsLitro, true, v => fBRL3.format(v))}</td>
        <td class="dir num">${fNum(u.qtdMultas)}</td><td class="dir num">${brl(u.custoMultas)}</td></tr>`;
    }).join('')}</tbody>`;
    t.querySelectorAll('th').forEach(th => th.addEventListener('click', () => { const c = th.dataset.c; st.ordem = { col: c, dir: st.ordem.col === c ? -st.ordem.dir : (c === 'unidade' ? 1 : -1) }; renderPainel(); }));
    t.querySelectorAll('tr[data-u]').forEach(tr => tr.addEventListener('click', () => filtrarUnidade(tr.dataset.u)));
  }

  function renderEvolucao(ab, mu) {
    const E = D.evolucao(ab, mu);
    if (st.graficos.gEvol) st.graficos.gEvol.destroy();
    $('#tituloEvol').textContent = E.mensal ? 'Evolução mensal' : 'Evolução semanal';
    const rot = E.chaves.map(k => (E.mensal ? k.slice(5, 7) + '/' + k.slice(2, 4) : dBR(k).slice(0, 5)));
    const grade = css('--border'), txt = css('--text-3');
    st.graficos.gEvol = new Chart($('#gEvol'), {
      type: 'bar',
      data: { labels: rot, datasets: [
        { label: 'Diesel', data: E.diesel, backgroundColor: css('--s1') },
        { label: 'Arla e outros', data: E.arla, backgroundColor: css('--s3') },
        { label: 'Multas', data: E.multas, backgroundColor: css('--s2') }
      ].map(d => Object.assign(d, { borderColor: css('--surface'), borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 34 })) },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: txt } },
          y: { stacked: true, grid: { color: grade }, border: { display: false }, ticks: { color: txt, callback: v => brlCurto(v) } }
        },
        plugins: {
          legend: { position: 'top', align: 'end', labels: { color: css('--text-2'), boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
          tooltip: { callbacks: { title: c => (E.mensal ? 'Mês ' : 'Semana de ') + c[0].label, label: c => ` ${c.dataset.label}: ${brl(c.raw)}`, footer: c => 'Total: ' + brl(c.reduce((s, x) => s + x.raw, 0)) } }
        }
      }
    });
  }

  function renderTopPlacas(abc) {
    const t = $('#tabPlacas');
    if (!abc.length) { t.innerHTML = `<tr><td class="vazio">Sem abastecimentos de diesel no período</td></tr>`; return; }
    const kmLmed = D.indicadores(D.filtrar(st.ctx, Object.assign({}, st.filtro, intervalo())).ab, []).kmL;
    t.innerHTML = `<thead><tr><th>Classe</th><th>Placa</th><th>Unidade</th><th>Modelo</th><th class="dir">Diesel</th><th class="dir">% acumulado</th><th class="dir">Litros</th><th class="dir">Km válidos</th><th class="dir">km/L</th><th class="dir">Multas</th></tr></thead><tbody>${abc.slice(0, 15).map(p => `
      <tr><td><span class="abc-badge abc-${p.classe}">${p.classe}</span></td><td><b>${esc(p.placa)}</b></td><td><span class="unid-cor" style="background:${corUnidade(p.unidade)}"></span>${esc(p.unidade)}</td><td style="color:var(--text-2)">${esc(p.modelo)}</td>
      <td class="dir num">${brl(p.custoDiesel)}</td><td class="dir num">${pct(p.acumulado)}</td><td class="dir num">${fNum(p.litrosDiesel)}</td><td class="dir num">${fNum(p.km)}</td>
      <td class="dir">${chipVsMedia(p.kmL, kmLmed, false, v => fNum(v, 2))}</td><td class="dir num">${p.qtdMultas ? brl(p.custoMultas) : '—'}</td></tr>`).join('')}</tbody>`;
  }

  // ---------- pontos de atenção (com correção) ----------
  function renderAtencao(ab, mu) {
    const A = D.pontosAtencao(st.ctx, ab, mu);
    const itens = [];
    const ufOpts = sel => `<option value="">UF…</option>` + D.SIGLAS.map(s => `<option ${s === sel ? 'selected' : ''}>${s}</option>`).join('');
    if (A.placasSemUnidade.size) itens.push({
      cls: 'crit', ic: '!', t: `${A.placasSemUnidade.size} placas sem unidade`, s: 'Os custos delas aparecem como "SEM UNIDADE". Defina a unidade aqui.',
      det: `<table><thead><tr><th>Placa</th><th>Registros</th><th>Unidade</th><th></th></tr></thead><tbody>${[...A.placasSemUnidade].map(([p, n]) => `<tr><td><b>${esc(p)}</b></td><td>${n}</td><td><input data-placa="${esc(p)}" list="listaUnidades" placeholder="Unidade"></td><td><button class="btn peq" data-acao="unid" data-placa="${esc(p)}">Salvar</button></td></tr>`).join('')}</tbody></table>`
    });
    if (A.multasSemUF.length) itens.push({
      cls: 'warn', ic: '?', t: `${A.multasSemUF.length} multas sem estado identificado`, s: 'Não deu para descobrir a UF pelo LOCAL. Escolha o estado.',
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Local</th><th class="dir">Valor</th><th>UF</th></tr></thead><tbody>${A.multasSemUF.slice(0, 60).map(m => `<tr><td>${dBR(m.data)}</td><td>${esc(m.placa)}</td><td style="white-space:normal;max-width:320px">${esc(m.local || '(vazio)')}</td><td class="dir num">${brl(m.valor)}</td><td><select data-acao="ufmulta" data-id="${esc(m.id)}">${ufOpts('')}</select></td></tr>`).join('')}</tbody></table>`
    });
    if (A.kmInv.length) itens.push({
      cls: 'warn', ic: 'km', t: `${A.kmInv.length} abastecimentos com hodômetro inválido`, s: `Km zero ou acima de ${fNum(st.ctx.kmMax)} km. Ficam fora do R$/km e do km/L.`,
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Unidade</th><th class="dir">Km informado</th><th class="dir">Litros</th><th>Posto</th></tr></thead><tbody>${A.kmInv.slice(0, 60).map(a => `<tr><td>${dBR(a.data)}</td><td>${esc(a.placa)}</td><td>${esc(a.unidade)}</td><td class="dir num">${fNum(a.km)}</td><td class="dir num">${fNum(a.litros, 1)}</td><td>${esc(a.posto)}</td></tr>`).join('')}</tbody></table>`
    });
    if (A.precoAlto.length) itens.push({
      cls: 'info', ic: 'R$', t: `${A.precoAlto.length} abastecimentos com diesel caro`, s: `Litro mais de 15% acima da média do período (${fBRL3.format(A.mediaPreco)}).`,
      det: `<table><thead><tr><th>Data</th><th>Placa</th><th>Posto</th><th>UF</th><th class="dir">R$/litro</th></tr></thead><tbody>${A.precoAlto.sort((a, b) => b.preco - a.preco).slice(0, 40).map(a => `<tr><td>${dBR(a.data)}</td><td>${esc(a.placa)}</td><td>${esc(a.posto)}</td><td>${esc(a.uf)}</td><td class="dir num">${fBRL3.format(a.preco)}</td></tr>`).join('')}</tbody></table>`
    });
    if (A.forasCadastro.size) itens.push({ cls: 'info', ic: 'i', t: `${A.forasCadastro.size} placas de multas fora do cadastro`, s: [...A.forasCadastro].join(', ') + '. Confira se a placa foi digitada certo ou cadastre o veículo.' });

    const el = $('#atencao');
    if (!itens.length) { el.innerHTML = `<div class="at-item"><div class="at-icone info" style="color:var(--good-text)">✓</div><div class="at-txt"><b>Tudo certo</b><span>Nenhum problema nos dados do período.</span></div></div>`; return; }
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

  // ---------- dados ----------
  const DEF = {
    abastecimentos: {
      lista: () => D.filtrar(st.ctx, Object.assign({}, st.filtro, intervalo())).ab,
      cols: [['data', 'Data', dBR], ['hora', 'Hora'], ['placa', 'Placa'], ['unidade', 'Unidade'], ['motorista', 'Motorista'], ['posto', 'Posto'], ['cidade', 'Cidade'], ['uf', 'UF'], ['combustivelNome', 'Combustível'], ['litros', 'Litros', v => fNum(v, 2), 1], ['preco', 'R$/L', v => (v == null ? '—' : fBRL3.format(v)), 1], ['valor', 'Valor', brl, 1], ['km', 'Km', v => fNum(v), 1], ['kmValido', 'Km válido', v => (v ? 'Sim' : 'Não')]]
    },
    multas: {
      lista: () => D.filtrar(st.ctx, Object.assign({}, st.filtro, intervalo())).mu,
      cols: [['data', 'Data', dBR], ['placa', 'Placa'], ['unidade', 'Unidade'], ['ufCalc', 'UF'], ['local', 'Local'], ['tipo', 'Infração'], ['numero', 'Nº'], ['motorista', 'Motorista'], ['orgao', 'Órgão'], ['valor', 'Valor', brl, 1], ['venc', 'Vencimento', dBR], ['aba', 'Aba']]
    },
    frota: {
      lista: () => st.base.frota.map(f => Object.assign({}, f, { unidadeFinal: st.ctx.unidadePlaca(f.placa) })),
      cols: [['placa', 'Placa'], ['unidadeFinal', 'Unidade'], ['situacao', 'Situação'], ['tipo', 'Tipo'], ['modelo', 'Modelo']]
    },
    abc: {
      lista: () => { const { ab, mu } = D.filtrar(st.ctx, Object.assign({}, st.filtro, intervalo())); return D.curvaABC(D.porPlaca(ab, mu, st.ctx), p => p.custoDiesel); },
      cols: [['classe', 'Classe'], ['placa', 'Placa'], ['unidade', 'Unidade'], ['modelo', 'Modelo'], ['custoDiesel', 'Diesel', brl, 1], ['pct', '% do diesel', v => pct(v, 1), 1], ['acumulado', '% acumulado', v => pct(v, 1), 1], ['litrosDiesel', 'Litros', v => fNum(v), 1], ['km', 'Km válidos', v => fNum(v), 1], ['kmL', 'km/L', v => fNum(v, 2), 1], ['rsKm', 'R$/km', v => (v == null ? '—' : fBRL3.format(v)), 1], ['custoMultas', 'Multas', brl, 1]]
    }
  };
  function linhasDados() {
    const def = DEF[st.dadosAba];
    const q = D.normUnidade($('#busca').value).replace(D.SEM_UNIDADE, '');
    let l = def.lista();
    if (q) l = l.filter(r => def.cols.some(([k]) => String(r[k] ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q)));
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
    preencherFiltros();
    renderPainel();
    renderImportar();
    renderAjustes();
    if ($('#tela-dados').classList.contains('ativa')) renderDados();
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
      $$('#segPeriodo button').forEach(x => x.classList.toggle('ativo', x === b));
      $('#campoDatas').hidden = b.dataset.p !== 'livre';
      if (b.dataset.p === 'livre' && !st.filtro.de) { const iv = { de: addDias(ultimaData(), -29), ate: ultimaData() }; st.filtro.de = iv.de; st.filtro.ate = iv.ate; $('#fDe').value = iv.de; $('#fAte').value = iv.ate; }
      renderPainel();
    }));
    $('#fDe').addEventListener('change', e => { st.filtro.de = e.target.value; renderPainel(); });
    $('#fAte').addEventListener('change', e => { st.filtro.ate = e.target.value; renderPainel(); });
    $('#fUnidade').addEventListener('change', e => { st.filtro.unidade = e.target.value; renderPainel(); });
    $('#fUF').addEventListener('change', e => { st.filtro.uf = e.target.value; renderPainel(); });
    $('#btnLimpar').addEventListener('click', () => { st.filtro.unidade = ''; st.filtro.uf = ''; preencherFiltros(); renderPainel(); });

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
  window.App = { estado: st, importarBuffer: (nome, buf) => importar([new File([buf], nome)]) };
  if (!window.XLSX || !window.Chart) { document.body.insertAdjacentHTML('afterbegin', '<div class="aviso mostra" style="margin:16px">Não consegui carregar as bibliotecas (sem internet?). O painel precisa de internet para abrir os gráficos e ler as planilhas.</div>'); }
  else iniciar();
})();
