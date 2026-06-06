const STORAGE_KEY   = 'arara_vagoes_ativos_v3';
const STORAGE_CFG   = 'arara_config_v3';
const STORAGE_USERS = 'arara_users_v1';
const STORAGE_LOG   = 'arara_log_v1';

let composicoesAtivas = [];
let config  = { limite_estadia: 24 };
let usuarios = [];
let logEntradas = [];
let vagaoSelecionado  = null;
let statusSelecionado = null;
let motivoEstadiaPendente = null;

const STATUS_VISIVEIS = ['nao_posicionado', 'posicionado', 'vazio', 'liberado'];

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
function init() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) composicoesAtivas = JSON.parse(salvo);

  const cfgSalvo = localStorage.getItem(STORAGE_CFG);
  if (cfgSalvo) config = { ...config, ...JSON.parse(cfgSalvo) };

  const usersSalvo = localStorage.getItem(STORAGE_USERS);
  usuarios = usersSalvo ? JSON.parse(usersSalvo)
    : [{ id: 1, nome: 'Administrador', login: 'admin', senha: '1234', nivel: 'admin' }];
  if (!usersSalvo) salvarUsuarios();

  const logSalvo = localStorage.getItem(STORAGE_LOG);
  logEntradas = logSalvo ? JSON.parse(logSalvo) : [];

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLiberacao();
  configurarGestao();
  configurarBusca();
  configurarTeclas();

  document.getElementById('alerta-modal-fechar').addEventListener('click', fecharModalAlerta);
  document.getElementById('tv-fechar').addEventListener('click', fecharModoTV);

  document.getElementById('cfg-limite').value = config.limite_estadia;

  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('comp-data').value = hoje;
  document.getElementById('lib-data').value  = hoje;

  atualizarInterface();

  setInterval(() => {
    atualizarRelogio();
    renderFarol();
    atualizarBadgeTitulo();
    if (document.getElementById('tv-overlay').style.display !== 'none') renderTV();
  }, 1000);
}

function salvarDados() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(composicoesAtivas));
  atualizarInterface();
}
function salvarUsuarios() { localStorage.setItem(STORAGE_USERS, JSON.stringify(usuarios)); }
function salvarLog()      { localStorage.setItem(STORAGE_LOG,   JSON.stringify(logEntradas)); }

function registrarLog(vagaoId, statusAnterior, statusNovo, motivo) {
  logEntradas.unshift({
    ts: new Date().toISOString(),
    vagaoId,
    statusAnterior,
    statusNovo,
    motivo: motivo || null,
    usuario: 'admin' // futuro: usuário logado
  });
  if (logEntradas.length > 500) logEntradas = logEntradas.slice(0, 500);
  salvarLog();
}

function atualizarInterface() {
  atualizarRelogio();
  renderPainelFIFO();
  renderFarol();
  renderLiberacao();
  renderUsuarios();
  renderLog();
  atualizarBadgeTitulo();
}

// ════════════════════════════════════════
//  RELÓGIO + BADGE TÍTULO
// ════════════════════════════════════════
function atualizarRelogio() {
  const agora = new Date();
  const el = document.getElementById('relogio');
  if (el) el.textContent = agora.toLocaleDateString('pt-BR') + ' '
    + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function atualizarBadgeTitulo() {
  let estourados = 0;
  const agora = Date.now();
  const limiteEstadia = config.limite_estadia * 3600000;
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status)) {
        if ((agora - new Date(comp.chegadaDt).getTime()) >= limiteEstadia) estourados++;
      }
    });
  });
  document.title = estourados > 0
    ? `⚠ (${estourados}) CD Arará | Controle de Vagões`
    : 'CD Arará | Controle de Vagões';
}

// ════════════════════════════════════════
//  ABAS
// ════════════════════════════════════════
function configurarAbas() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

function irParaAba(tab) {
  document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
  document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
}

// ════════════════════════════════════════
//  ATALHOS DE TECLADO
// ════════════════════════════════════════
function configurarTeclas() {
  document.addEventListener('keydown', e => {
    // Não disparar dentro de inputs
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const modaisAbertos = document.querySelector('.modal-overlay[style*="flex"]');
    if (modaisAbertos) {
      if (e.key === 'Escape') {
        fecharModal(); fecharModalAlerta();
        if (document.getElementById('tv-overlay').style.display !== 'none') fecharModoTV();
      }
      return;
    }
    switch(e.key.toLowerCase()) {
      case 'n': irParaAba('painel');
        setTimeout(() => document.getElementById('comp-vagoes').focus(), 100); break;
      case 'l': irParaAba('liberacao'); break;
      case 'g': irParaAba('gestao');    break;
      case 't': abrirModoTV();          break;
      case '/': e.preventDefault();
        document.getElementById('busca-vagao').focus(); break;
    }
  });
}

// ════════════════════════════════════════
//  BUSCA RÁPIDA
// ════════════════════════════════════════
function configurarBusca() {
  const input = document.getElementById('busca-vagao');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toUpperCase();
    highlightBusca(q);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; highlightBusca(''); input.blur(); }
    if (e.key === 'Enter' && input.value.trim()) {
      const q = input.value.trim().toUpperCase();
      // Tenta abrir modal direto se ID exato
      const v = encontrarVagao(q);
      if (v) abrirModal(q);
    }
  });
}

function highlightBusca(q) {
  document.querySelectorAll('.vagao-slot-fifo').forEach(slot => {
    const bolinha = slot.querySelector('.bolinha');
    const label   = slot.querySelector('.vagao-id');
    if (!bolinha || bolinha.classList.contains('slot-vazio')) return;
    const id = bolinha.getAttribute('data-id') || '';
    if (q && id.includes(q)) {
      slot.style.opacity = '1';
      slot.style.transform = 'scale(1.2)';
      bolinha.style.outline = '2.5px solid #fff';
    } else if (q) {
      slot.style.opacity = '0.25';
      slot.style.transform = '';
      bolinha.style.outline = '';
    } else {
      slot.style.opacity = '';
      slot.style.transform = '';
      bolinha.style.outline = '';
    }
  });
}

function encontrarVagao(id) {
  for (const comp of composicoesAtivas) {
    const v = comp.vagoes.find(v => v.id === id);
    if (v) return { vagao: v, comp };
  }
  return null;
}

// ════════════════════════════════════════
//  NOVA COMPOSIÇÃO
// ════════════════════════════════════════
function configurarFormComposicao() {
  document.getElementById('btn-nova-comp').addEventListener('click', () => {
    const data  = document.getElementById('comp-data').value;
    const hora  = document.getElementById('comp-hora').value;
    const texto = document.getElementById('comp-vagoes').value;
    if (!data || !hora || !texto.trim()) { alert('Preencha data, hora e os IDs dos vagões.'); return; }

    const ids = texto.split(/[\n,]+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0);
    const chegadaDt = `${data}T${hora}`;

    composicoesAtivas.push({
      chegadaDt,
      vagoes: ids.map(id => ({ id, status: 'nao_posicionado', posDt: null, fimDt: null }))
    });

    ids.forEach(id => registrarLog(id, null, 'nao_posicionado', 'Chegada registrada'));
    salvarDados();
    document.getElementById('comp-vagoes').value = '';
    alert(`${ids.length} vagão(ões) inserido(s) no pátio.`);
  });
}

// ════════════════════════════════════════
//  PAINEL FIFO
// ════════════════════════════════════════
function renderPainelFIFO() {
  const container = document.getElementById('painel-vagoes-fifo');
  const resumo    = document.getElementById('patio-resumo');
  if (!container) return;
  container.innerHTML = '';

  let vagoesFila = [];
  let resumosDict = {};

  composicoesAtivas.forEach(comp => {
    const visiveis = comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status));
    if (visiveis.length > 0) {
      const chave = formatarDataResumo(comp.chegadaDt);
      resumosDict[chave] = (resumosDict[chave] || 0) + visiveis.length;
      visiveis.forEach(v => vagoesFila.push({ ...v, chegadaDt: comp.chegadaDt }));
    }
  });

  if (vagoesFila.length === 0) {
    resumo.textContent = 'Pátio Atual: Limpo — Sem operações ativas';
  } else {
    resumo.textContent = 'Pátio: ' + Object.keys(resumosDict).map(k => `${k} — ${resumosDict[k]} FLTs`).join(' | ');
  }

  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';

    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      const cssClass = statusToCss(v.status);
      const idCurto  = v.id.length > 7 ? v.id.slice(-7) : v.id;
      const tpvMs    = Date.now() - new Date(v.chegadaDt).getTime();
      const limEst   = config.limite_estadia * 3600000;
      const limRis   = (config.limite_estadia - 4) * 3600000;
      let alertaClass = '';
      let tooltipExtra = '';
      if (tpvMs >= limEst)      { alertaClass = 'alerta-estadia'; tooltipExtra = ` ⚠ ESTADIA ${formatarMs(tpvMs)}`; }
      else if (tpvMs >= limRis) { alertaClass = 'alerta-risco';   tooltipExtra = ` ⚠ RISCO ${formatarMs(tpvMs)}`; }

      slot.innerHTML = `
        <div class="bolinha ${cssClass} ${alertaClass}"
          data-id="${v.id}"
          title="${v.id} — ${statusLabel(v.status)}${tooltipExtra}"
          style="cursor:pointer;"></div>
        <div class="vagao-id">${idCurto}</div>`;
      slot.querySelector('.bolinha').addEventListener('click', () => abrirModal(v.id));
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }
}

function statusToCss(status) {
  return { nao_posicionado:'nao_posicionado', posicionado:'posicionado', vazio:'vazio', liberado:'liberado_aguardando' }[status] || 'vazio';
}
function statusLabel(status) {
  return { nao_posicionado:'Não Posicionado', posicionado:'Posicionado', vazio:'Vazio', liberado:'Liberado' }[status] || status;
}
function formatarDataResumo(dtString) {
  const dt = new Date(dtString);
  return `${String(dt.getDate()).padStart(2,'0')}/${ ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][dt.getMonth()] }`;
}

// ════════════════════════════════════════
//  MODAL VAGÃO
// ════════════════════════════════════════
const MOTIVOS_ESTADIA = [
  'Aguardando manobra MRS',
  'Problema mecânico no vagão',
  'Fila de carregamento',
  'Aguardando documento/NF',
  'Operação suspensa',
  'Outro'
];

function configurarModal() {
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);

  document.querySelectorAll('.status-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.status-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      statusSelecionado = opt.dataset.val;
      atualizarCamposModal(statusSelecionado);
    });
  });

  document.getElementById('modal-salvar').addEventListener('click', salvarStatusVagao);
}

function salvarStatusVagao() {
  if (!vagaoSelecionado || !statusSelecionado) return;

  // Verifica se está em estadia e mudando p/ não posicionado ou posicionado — pede motivo
  const res = encontrarVagao(vagaoSelecionado);
  if (res) {
    const tpvMs = Date.now() - new Date(res.comp.chegadaDt).getTime();
    const limEst = config.limite_estadia * 3600000;
    if (tpvMs >= limEst && !motivoEstadiaPendente) {
      abrirModalMotivo();
      return;
    }
  }

  for (const comp of composicoesAtivas) {
    const vagao = comp.vagoes.find(v => v.id === vagaoSelecionado);
    if (vagao) {
      const statusAnt = vagao.status;
      vagao.status = statusSelecionado;
      vagao.posDt  = document.getElementById('modal-dt-pos').value || null;
      if (statusSelecionado === 'liberado' || statusSelecionado === 'vazio') {
        vagao.fimDt = document.getElementById('modal-dt-fim').value || new Date().toISOString().slice(0,16);
      } else {
        vagao.fimDt = null;
      }
      registrarLog(vagaoSelecionado, statusAnt, statusSelecionado, motivoEstadiaPendente);
      break;
    }
  }
  composicoesAtivas = composicoesAtivas.filter(c => c.vagoes.length > 0);
  motivoEstadiaPendente = null;
  fecharModal();
  salvarDados();
}

function abrirModalMotivo() {
  const sel = document.getElementById('motivo-select');
  sel.innerHTML = MOTIVOS_ESTADIA.map(m => `<option>${m}</option>`).join('');
  document.getElementById('motivo-modal').style.display = 'flex';
}

function atualizarCamposModal(status) {
  document.getElementById('grp-posicionamento').style.display =
    (status === 'posicionado' || status === 'vazio' || status === 'liberado') ? 'block' : 'none';
  document.getElementById('grp-fim').style.display =
    (status === 'vazio' || status === 'liberado') ? 'block' : 'none';
}

function abrirModal(id) {
  vagaoSelecionado  = id;
  motivoEstadiaPendente = null;
  let chegada = '', vagaoEncontrado = null;

  for (const comp of composicoesAtivas) {
    const v = comp.vagoes.find(v => v.id === id);
    if (v) { vagaoEncontrado = v; chegada = comp.chegadaDt; break; }
  }
  if (!vagaoEncontrado) return;

  const tpvMs = Date.now() - new Date(chegada).getTime();
  document.getElementById('modal-vagao-id').textContent = id;
  document.getElementById('modal-vagao-chegada').textContent =
    'Chegada: ' + new Date(chegada).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
    + ' · TPV: ' + formatarMs(tpvMs);

  statusSelecionado = vagaoEncontrado.status;
  document.querySelectorAll('.status-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.val === statusSelecionado));

  document.getElementById('modal-dt-pos').value = vagaoEncontrado.posDt || '';
  document.getElementById('modal-dt-fim').value = vagaoEncontrado.fimDt || '';
  atualizarCamposModal(statusSelecionado);
  document.getElementById('vagao-modal').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado = statusSelecionado = motivoEstadiaPendente = null;
}

// ════════════════════════════════════════
//  MODAL MOTIVO ESTADIA
// ════════════════════════════════════════
function configurarModalMotivo() {
  document.getElementById('motivo-confirmar').addEventListener('click', () => {
    const sel = document.getElementById('motivo-select').value;
    const custom = document.getElementById('motivo-custom').value.trim();
    motivoEstadiaPendente = sel === 'Outro' && custom ? custom : sel;
    document.getElementById('motivo-modal').style.display = 'none';
    salvarStatusVagao();
  });
  document.getElementById('motivo-fechar').addEventListener('click', () => {
    document.getElementById('motivo-modal').style.display = 'none';
    motivoEstadiaPendente = null;
  });
  document.getElementById('motivo-select').addEventListener('change', e => {
    document.getElementById('grp-motivo-custom').style.display =
      e.target.value === 'Outro' ? 'block' : 'none';
  });
}

// ════════════════════════════════════════
//  FAROL
// ════════════════════════════════════════
function renderFarol() {
  let ativos = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status)) ativos.push({ ...v, chegadaDt: comp.chegadaDt });
    });
  });

  const agora = Date.now();
  const limEst = config.limite_estadia * 3600000;
  const limRis = (config.limite_estadia - 4) * 3600000;

  let maxTpvMs = 0, somaPosMs = 0, countPos = 0, somaEsperaMs = 0, countEspera = 0;
  let vagoes_estadia = [], vagoes_risco = [];

  ativos.forEach(v => {
    const tpv = agora - new Date(v.chegadaDt).getTime();
    if (tpv > maxTpvMs) maxTpvMs = tpv;
    if (tpv >= limEst)      vagoes_estadia.push({ ...v, tpvMs: tpv });
    else if (tpv >= limRis) vagoes_risco.push({ ...v, tpvMs: tpv });
    if (v.posDt) { somaPosMs   += agora - new Date(v.posDt).getTime(); countPos++;    }
    else         { somaEsperaMs += tpv;                                  countEspera++; }
  });

  vagoes_estadia.sort((a,b) => b.tpvMs - a.tpvMs);
  vagoes_risco.sort((a,b)   => b.tpvMs - a.tpvMs);

  const backlog = Math.max(0, ativos.length - 30);

  document.getElementById('val-tpv').innerText     = maxTpvMs > 0 ? formatarMs(maxTpvMs) : '—';
  document.getElementById('val-pos').innerText     = countPos > 0 ? formatarMs(somaPosMs / countPos) : '—';
  document.getElementById('val-espera').innerText  = countEspera > 0 ? formatarMs(somaEsperaMs / countEspera) : '—';
  document.getElementById('val-estadia').innerText = vagoes_estadia.length;
  document.getElementById('val-risco').innerText   = vagoes_risco.length;
  document.getElementById('val-backlog').innerText = backlog;

  const fe = document.getElementById('farol-estadia');
  const fr = document.getElementById('farol-risco');
  fe.classList.toggle('alerta-estadia', vagoes_estadia.length > 0);
  fr.classList.toggle('alerta-risco',   vagoes_risco.length > 0);
  fe.classList.toggle('clicavel', vagoes_estadia.length > 0);
  fr.classList.toggle('clicavel', vagoes_risco.length > 0);
  fe.onclick = vagoes_estadia.length > 0 ? () => abrirModalAlerta('estadia', vagoes_estadia) : null;
  fr.onclick = vagoes_risco.length > 0   ? () => abrirModalAlerta('risco',   vagoes_risco)   : null;
}

function formatarMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
}

// ════════════════════════════════════════
//  MODAL ALERTA ESTADIA/RISCO
// ════════════════════════════════════════
function abrirModalAlerta(tipo, vagoes) {
  const isEst  = tipo === 'estadia';
  const titulo = isEst ? '⚠ Vagões em Estadia' : '⚠ Vagões em Risco';
  const sub    = isEst
    ? `${vagoes.length} vagão(ões) com mais de ${config.limite_estadia}h no pátio`
    : `${vagoes.length} vagão(ões) entre ${config.limite_estadia - 4}h e ${config.limite_estadia}h`;

  document.getElementById('alerta-modal-titulo').textContent = titulo;
  document.getElementById('alerta-modal-sub').textContent    = sub;
  document.getElementById('alerta-modal-header').style.background = isEst
    ? 'linear-gradient(90deg,rgba(180,20,20,.88),rgba(220,38,38,.82))'
    : 'linear-gradient(90deg,rgba(140,80,0,.88),rgba(202,138,4,.82))';
  document.getElementById('alerta-modal-info').textContent =
    'Clique num vagão para abrir o painel de status. Ordenado do mais crítico ao menos crítico.';

  document.getElementById('alerta-modal-lista').innerHTML = vagoes.map(v => {
    const dc  = isEst ? 'estadia' : 'risco';
    const ch  = new Date(v.chegadaDt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<div class="alerta-vagao-item" onclick="fecharModalAlerta();setTimeout(()=>abrirModal('${v.id}'),120);">
      <div class="alerta-dot ${dc}"></div>
      <div><div class="alerta-id">${v.id}</div><div class="alerta-hint">Chegada: ${ch} · ${statusLabel(v.status)}</div></div>
      <span class="alerta-tempo ${dc}">${formatarMs(v.tpvMs)}</span>
    </div>`;
  }).join('');

  document.getElementById('alerta-modal').style.display = 'flex';
}

function fecharModalAlerta() { document.getElementById('alerta-modal').style.display = 'none'; }

document.addEventListener('click', e => {
  if (e.target === document.getElementById('alerta-modal')) fecharModalAlerta();
  if (e.target === document.getElementById('motivo-modal'))
    document.getElementById('motivo-modal').style.display = 'none';
});

// ════════════════════════════════════════
//  MODO TV
// ════════════════════════════════════════
function abrirModoTV() {
  renderTV();
  document.getElementById('tv-overlay').style.display = 'flex';
}
function fecharModoTV() { document.getElementById('tv-overlay').style.display = 'none'; }

function renderTV() {
  // Farol TV
  const agora = Date.now();
  const limEst = config.limite_estadia * 3600000;
  const limRis = (config.limite_estadia - 4) * 3600000;
  let ativos = [], estourados = 0, risco = 0, maxTpv = 0;
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status)) {
        const tpv = agora - new Date(comp.chegadaDt).getTime();
        ativos.push({ ...v, chegadaDt: comp.chegadaDt, tpvMs: tpv });
        if (tpv > maxTpv) maxTpv = tpv;
        if (tpv >= limEst) estourados++;
        else if (tpv >= limRis) risco++;
      }
    });
  });

  document.getElementById('tv-relogio').textContent =
    new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('tv-tpv').textContent     = maxTpv > 0 ? formatarMs(maxTpv) : '—';
  document.getElementById('tv-estadia').textContent = estourados;
  document.getElementById('tv-risco').textContent   = risco;
  document.getElementById('tv-total').textContent   = ativos.length;

  const fe = document.getElementById('tv-farol-estadia');
  const fr = document.getElementById('tv-farol-risco');
  fe.classList.toggle('alerta-estadia', estourados > 0);
  fr.classList.toggle('alerta-risco',   risco > 0);

  // Pátio TV
  const container = document.getElementById('tv-painel');
  container.innerHTML = '';

  let vagoesFila = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status))
      .forEach(v => vagoesFila.push({ ...v, chegadaDt: comp.chegadaDt }));
  });

  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';
    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      const css = statusToCss(v.status);
      const tpv = agora - new Date(v.chegadaDt).getTime();
      let alertaCls = '';
      if (tpv >= limEst)      alertaCls = 'alerta-estadia';
      else if (tpv >= limRis) alertaCls = 'alerta-risco';
      const idCurto = v.id.length > 7 ? v.id.slice(-7) : v.id;
      slot.innerHTML = `
        <div class="bolinha ${css} ${alertaCls}" style="width:32px;height:32px;" title="${v.id}"></div>
        <div class="vagao-id" style="font-size:0.55rem;">${idCurto}</div>`;
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio" style="width:32px;height:32px;"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }

  // Resumo pátio TV
  let resumosDict = {};
  composicoesAtivas.forEach(comp => {
    const n = comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status)).length;
    if (n > 0) resumosDict[formatarDataResumo(comp.chegadaDt)] = (resumosDict[formatarDataResumo(comp.chegadaDt)] || 0) + n;
  });
  document.getElementById('tv-resumo').textContent = Object.keys(resumosDict).length
    ? 'Pátio: ' + Object.keys(resumosDict).map(k => `${k} — ${resumosDict[k]} FLTs`).join(' | ')
    : 'Pátio limpo';
}

// ════════════════════════════════════════
//  LIBERAÇÃO
// ════════════════════════════════════════
function configurarLiberacao() {
  document.getElementById('btn-gerar-form').addEventListener('click', gerarFormularioImpressao);
  document.getElementById('btn-confirmar-devolucao').addEventListener('click', confirmarDevolucaoMRS);
}

function renderLiberacao() {
  const div = document.getElementById('lista-liberacao');
  let html = '';
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (v.status === 'liberado') {
        html += `<label class="liberacao-item">
          <input type="checkbox" class="check-liberacao" value="${v.id}">
          <span class="lib-id">${v.id}</span>
          <span class="lib-status-badge">✓ Liberado</span>
        </label>`;
      }
    });
  });
  div.innerHTML = html || '<div class="vazio-msg">Mude o status de um vagão para "Liberado" no painel para que ele apareça aqui.</div>';
}

function confirmarDevolucaoMRS() {
  const sel = [...document.querySelectorAll('.check-liberacao:checked')].map(cb => cb.value);
  if (!sel.length) { alert('Selecione ao menos um vagão.'); return; }
  if (!confirm(`Confirmar devolução de ${sel.length} vagão(ões) à MRS? Eles serão removidos do pátio.`)) return;
  composicoesAtivas.forEach(comp => { comp.vagoes = comp.vagoes.filter(v => !sel.includes(v.id)); });
  composicoesAtivas = composicoesAtivas.filter(c => c.vagoes.length > 0);
  sel.forEach(id => registrarLog(id, 'liberado', 'devolvido', 'Devolução MRS confirmada'));
  salvarDados();
  alert(`${sel.length} vagão(ões) devolvido(s) com sucesso.`);
}

function gerarFormularioImpressao() {
  const plts = document.getElementById('lib-plts').value || '______';
  let dataLib = document.getElementById('lib-data').value;
  if (dataLib) { const [a,m,d] = dataLib.split('-'); dataLib = `${d}/${m}/${a}`; }
  else dataLib = '___/___/______';
  const cbs = document.querySelectorAll('.check-liberacao:checked');
  if (!cbs.length) { alert('Selecione os vagões para gerar o formulário.'); return; }
  let listaHtml = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;font-size:11pt;">';
  cbs.forEach((cb, i) => { listaHtml += `<div><strong>${i+1}:</strong> ${cb.value}</div>`; });
  listaHtml += '</div>';
  ['csn','mrs'].forEach(via => {
    document.getElementById(`imp-plts-${via}`).innerText  = plts;
    document.getElementById(`imp-data-${via}`).innerText  = dataLib;
    document.getElementById(`imp-lista-${via}`).innerHTML = listaHtml;
  });
  window.print();
}

// ════════════════════════════════════════
//  LOG
// ════════════════════════════════════════
function renderLog() {
  const div = document.getElementById('log-lista');
  if (!div) return;
  if (!logEntradas.length) {
    div.innerHTML = '<div class="vazio-msg">Nenhuma movimentação registrada.</div>';
    return;
  }
  div.innerHTML = logEntradas.slice(0, 100).map(e => {
    const dt = new Date(e.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const antLabel = e.statusAnterior ? statusLabel(e.statusAnterior) : 'Entrada';
    const novLabel = e.statusNovo === 'devolvido' ? 'Devolvido MRS' : statusLabel(e.statusNovo);
    const motivo   = e.motivo ? `<span class="log-motivo">${e.motivo}</span>` : '';
    return `<div class="log-item">
      <div class="log-dt">${dt}</div>
      <div class="log-id">${e.vagaoId}</div>
      <div class="log-transicao">${antLabel} → ${novLabel}${motivo}</div>
    </div>`;
  }).join('');
}

function exportarCSV() {
  if (!logEntradas.length) { alert('Nenhum dado para exportar.'); return; }
  const header = ['Data/Hora','Vagão','Status Anterior','Status Novo','Motivo','Usuário'];
  const linhas = logEntradas.map(e => [
    new Date(e.ts).toLocaleString('pt-BR'),
    e.vagaoId,
    e.statusAnterior || 'Entrada',
    e.statusNovo,
    e.motivo || '',
    e.usuario || ''
  ].map(c => `"${c}"`).join(';'));
  const csv  = [header.join(';'), ...linhas].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `arara_log_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ════════════════════════════════════════
//  GESTÃO
// ════════════════════════════════════════
function configurarGestao() {
  document.getElementById('btn-salvar-cfg').addEventListener('click', () => {
    config.limite_estadia = parseInt(document.getElementById('cfg-limite').value) || 24;
    localStorage.setItem(STORAGE_CFG, JSON.stringify(config));
    alert('Configuração salva!'); renderFarol();
  });

  document.getElementById('btn-show-add-user').addEventListener('click', () => {
    const p = document.getElementById('add-user-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-cancel-add-user').addEventListener('click', () => {
    document.getElementById('add-user-panel').style.display = 'none'; limparFormUser();
  });
  document.getElementById('btn-add-user').addEventListener('click', () => {
    const nome  = document.getElementById('user-nome').value.trim();
    const login = document.getElementById('user-login').value.trim();
    const senha = document.getElementById('user-senha').value;
    const nivel = document.getElementById('user-nivel').value;
    if (!nome || !login || !senha) { alert('Preencha todos os campos.'); return; }
    if (usuarios.find(u => u.login === login)) { alert('Login já existe.'); return; }
    usuarios.push({ id: Date.now(), nome, login, senha, nivel });
    salvarUsuarios(); renderUsuarios();
    document.getElementById('add-user-panel').style.display = 'none'; limparFormUser();
  });

  document.getElementById('btn-exportar-csv')?.addEventListener('click', exportarCSV);
  document.getElementById('btn-abrir-tv')?.addEventListener('click', abrirModoTV);

  configurarModalMotivo();
}

function limparFormUser() {
  ['user-nome','user-login','user-senha'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('user-nivel').value = 'op';
}

function renderUsuarios() {
  const div = document.getElementById('user-list');
  if (!div) return;
  div.innerHTML = usuarios.map(u => {
    const badge   = {admin:'priv-admin',op:'priv-op',view:'priv-view'}[u.nivel] || 'priv-view';
    const labelNv = {admin:'Admin',op:'Operador',view:'Visualizador'}[u.nivel] || u.nivel;
    const delBtn  = u.id === 1 ? '' : `<button class="btn-delete" onclick="removerUsuario(${u.id})" title="Remover">🗑</button>`;
    return `<div class="user-item">
      <div class="user-avatar">${u.nome.charAt(0).toUpperCase()}</div>
      <div class="user-info"><div class="user-name">${u.nome}</div><div class="user-login">@${u.login}</div></div>
      <span class="priv-badge ${badge}">${labelNv}</span>${delBtn}
    </div>`;
  }).join('');
}

function removerUsuario(id) {
  if (!confirm('Remover este usuário?')) return;
  usuarios = usuarios.filter(u => u.id !== id);
  salvarUsuarios(); renderUsuarios();
}

window.onload = init;
