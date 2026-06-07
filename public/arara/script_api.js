// ============================================================
// script_api.js — CD Arará (versão backend PostgreSQL)
// Auth: JWT (8h) + tela de login própria
// ============================================================

// ── AUTH ──
let ARARA_TOKEN   = null;  // JWT
let ARARA_USUARIO = null;  // { nome, perfil }

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    ...(ARARA_TOKEN ? { 'Authorization': `Bearer ${ARARA_TOKEN}` } : {})
  };
}

// Header Basic Auth para rotas do AgendaCD (express-basic-auth)
function getBasicAuthHeader() {
  const stored = JSON.parse(localStorage.getItem('arara_auth') || '{}');
  const token  = btoa(`${stored.usuario || ''}:${stored.senha || ''}`);
  return { 'Content-Type': 'application/json', 'Authorization': `Basic ${token}` };
}

async function api(method, path, body) {
  try {
    const url = '/api/vagoes' + (path.startsWith('/') ? path : '/' + path);
    const res = await fetch(url, {
      method,
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) {
      mostrarLoginOverlay();
      return null;
    }
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.erro || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error('[api]', method, path, e);
    return null;
  }
}

// ── TELA DE LOGIN ──────────────────────────────────────────
function mostrarLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function esconderLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.style.display = 'none';
}

function configurarLogin() {
  const btnLogin  = document.getElementById('btn-login');
  const inputUser = document.getElementById('login-usuario');
  const inputSen  = document.getElementById('login-senha');

  async function tentarLogin() {
    const usuario = inputUser.value.trim();
    const senha   = inputSen.value;
    const errEl   = document.getElementById('login-erro');
    const blkEl   = document.getElementById('login-bloqueado');

    errEl.style.display = 'none';
    blkEl.style.display = 'none';
    btnLogin.disabled   = true;
    btnLogin.textContent = 'Entrando…';

    try {
      const res  = await fetch('/api/vagoes/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ usuario, senha })
      });
      const data = await res.json();

      if (res.status === 429) {
        blkEl.textContent  = data.erro;
        blkEl.style.display = 'block';
        btnLogin.disabled   = false;
        btnLogin.textContent = 'Entrar';
        // Reabilita o botão após o bloqueio acabar
        if (data.restam) setTimeout(() => { blkEl.style.display = 'none'; }, data.restam * 60 * 1000);
        return;
      }

      if (!res.ok) {
        errEl.textContent  = data.erro || 'Usuário ou senha incorretos.';
        errEl.style.display = 'block';
        btnLogin.disabled   = false;
        btnLogin.textContent = 'Entrar';
        inputSen.value = '';
        inputSen.focus();
        return;
      }

      // Sucesso
      ARARA_TOKEN   = data.token;
      ARARA_USUARIO = { nome: data.nome, perfil: data.perfil };
      localStorage.setItem('arara_auth', JSON.stringify({ usuario, senha }));
      localStorage.setItem('arara_token', data.token);

      esconderLoginOverlay();
      await inicializarApp();

    } catch (e) {
      errEl.textContent  = 'Erro de conexão. Tente novamente.';
      errEl.style.display = 'block';
      btnLogin.disabled   = false;
      btnLogin.textContent = 'Entrar';
    }
  }

  btnLogin.addEventListener('click', tentarLogin);
  inputSen.addEventListener('keydown', e => { if (e.key === 'Enter') tentarLogin(); });
  inputUser.addEventListener('keydown', e => { if (e.key === 'Enter') inputSen.focus(); });
}

function atualizarBadgeUsuario() {
  if (!ARARA_USUARIO) return;
  const badge  = document.getElementById('user-badge');
  const nome   = document.getElementById('user-nome-header');
  const avatar = document.getElementById('user-avatar');
  if (badge)  badge.style.display  = 'flex';
  if (nome)   nome.textContent     = ARARA_USUARIO.nome;
  if (avatar) avatar.textContent   = ARARA_USUARIO.nome.charAt(0).toUpperCase();

  // Gestão: mostrar/bloquear conforme perfil
  const semAcesso  = document.getElementById('gestao-sem-acesso');
  const conteudo   = document.getElementById('gestao-conteudo');
  const isAdmin    = ARARA_USUARIO.perfil === 'admin';
  if (semAcesso) semAcesso.style.display = isAdmin ? 'none'  : 'block';
  if (conteudo)  conteudo.style.display  = isAdmin ? 'block' : 'none';
}

function fazerLogout() {
  if (!confirm(`Sair da sessão de "${ARARA_USUARIO?.nome}"?`)) return;
  ARARA_TOKEN   = null;
  ARARA_USUARIO = null;
  localStorage.removeItem('arara_token');
  localStorage.removeItem('arara_auth');
  const badge = document.getElementById('user-badge');
  if (badge) badge.style.display = 'none';
  mostrarLoginOverlay();
  document.getElementById('login-usuario').value = '';
  document.getElementById('login-senha').value   = '';
}

async function tentarRestaurarSessao() {
  const token = localStorage.getItem('arara_token');
  if (!token) return false;
  try {
    const res = await fetch('/api/vagoes/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return false;
    const data    = await res.json();
    ARARA_TOKEN   = token;
    ARARA_USUARIO = { nome: data.nome, perfil: data.perfil };
    return true;
  } catch { return false; }
}

// ── ESTADO ──
let composicoesAtivas   = [];
let config              = { limite_estadia: 24 };
let vagaoSelecionado    = null;
let statusSelecionado   = null;
let modoSelecaoMultipla = false;
let vagoesSelecionados  = new Set();
let statusLoteSelecionado = null;

const STATUS_VISIVEIS = ['nao_posicionado', 'posicionado', 'vazio', 'liberado'];

// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
async function init() {
  configurarLogin();

  // Tenta restaurar sessão do token salvo
  const sessaoOk = await tentarRestaurarSessao();
  if (sessaoOk) {
    esconderLoginOverlay();
    await inicializarApp();
  } else {
    mostrarLoginOverlay();
    // A função tentarLogin() em configurarLogin() chamará inicializarApp() após sucesso
  }
}

async function inicializarApp() {
  atualizarBadgeUsuario();
  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarSelecaoMultipla();
  configurarModalLote();
  configurarLiberacao();
  configurarGestao();

  document.getElementById('alerta-modal-fechar').addEventListener('click', fecharModalAlerta);

  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('comp-data').value = hoje;
  document.getElementById('lib-data').value  = hoje;

  await carregarTudo();

  setInterval(() => {
    atualizarRelogio();
    renderFarol();
    const tvOverlay = document.getElementById('tv-overlay');
    if (tvOverlay && tvOverlay.style.display !== 'none') renderTV();
  }, 1000);
  setInterval(carregarTudo, 30000);
}

// ════════════════════════════════════════
//  CARREGAR DADOS DA API
// ════════════════════════════════════════
async function carregarTudo() {
  try {
    const [ativos, comps, cfg] = await Promise.all([
      api('GET', '/ativos').catch(() => []),
      api('GET', '/composicoes').catch(() => []),
      api('GET', '/config').catch(() => ({ limite_estadia: 24 }))
    ]);

    const listaAtivos = Array.isArray(ativos) ? ativos : [];
    const listaComps  = Array.isArray(comps)  ? comps  : [];

    composicoesAtivas = listaComps
      .map(comp => {
        const chegadaDt = comp.chegada_dt || comp.chegadaDt;
        const vagoes = listaAtivos
          .filter(v => v.composicao_id === comp.id)
          .map(v => ({
            id:    v.vagao_id,
            status: v.status,
            posDt: v.pos_dt ? String(v.pos_dt).slice(0, 16) : null,
            fimDt: v.fim_dt ? String(v.fim_dt).slice(0, 16) : null,
          }));
        return { id: comp.id, chegadaDt, vagoes };
      })
      .filter(comp => comp.vagoes.length > 0);

    if (cfg) {
      config = { limite_estadia: parseInt(cfg.limite_estadia) || 24 };
      const inputCfg = document.getElementById('cfg-limite');
      if (inputCfg) inputCfg.value = config.limite_estadia;
    }

    atualizarInterface();

  } catch (err) {
    console.error('Erro ao carregar dados:', err);
    composicoesAtivas = [];
    atualizarInterface();
  }
}

function atualizarInterface() {
  atualizarRelogio();
  renderPainelFIFO();
  renderFarol();
  renderLiberacao();
}

// ════════════════════════════════════════
//  RELÓGIO
// ════════════════════════════════════════
function atualizarRelogio() {
  const el = document.getElementById('relogio');
  if (!el) return;
  const agora = new Date();
  el.textContent = agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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

// ════════════════════════════════════════
//  NOVA COMPOSIÇÃO
// ════════════════════════════════════════
function configurarFormComposicao() {
  document.getElementById('btn-nova-comp').addEventListener('click', async () => {
    const data  = document.getElementById('comp-data').value;
    const hora  = document.getElementById('comp-hora').value;
    const texto = document.getElementById('comp-vagoes').value;

    if (!data || !hora || !texto.trim()) {
      alert('Preencha data, hora e os IDs dos vagões.');
      return;
    }

    const ids = texto
      .split(/[\n,\t\r]+/)
      .map(v => v.replace(/\s+/g, '').toUpperCase())
      .filter(v => v.length > 0);

    const btn = document.getElementById('btn-nova-comp');
    btn.disabled = true; btn.textContent = 'Registrando…';

    const resultado = await api('POST', '/composicoes', {
      chegadaDt: `${data}T${hora}`,
      vagoes: ids
    });

    btn.disabled = false; btn.textContent = 'Registrar Composição';

    if (resultado) {
      document.getElementById('comp-vagoes').value = '';
      alert(`${ids.length} vagão(ões) inserido(s) no pátio.`);
      await carregarTudo();
    }
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

  let vagoesFila  = [];
  let resumosDict = {};

  composicoesAtivas.forEach(comp => {
    const visiveis = comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status));
    if (visiveis.length > 0) {
      const chave = formatarDataResumo(comp.chegadaDt);
      resumosDict[chave] = (resumosDict[chave] || 0) + visiveis.length;
      visiveis.forEach(v => vagoesFila.push({ ...v, chegadaDt: comp.chegadaDt }));
    }
  });

  if (resumo) {
    resumo.textContent = vagoesFila.length === 0
      ? 'Pátio Atual: Limpo — Sem operações ativas'
      : 'Pátio: ' + Object.keys(resumosDict).map(k => `${k} — ${resumosDict[k]} FLTs`).join(' | ');
  }

  const agora  = Date.now();
  const limEst = config.limite_estadia * 3600000;
  const limRis = (config.limite_estadia - 4) * 3600000;

  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';

    if (i < vagoesFila.length) {
      const v        = vagoesFila[i];
      const cssClass = statusToCss(v.status);
      const idCurto  = v.id.length > 7 ? v.id.slice(-7) : v.id;
      const tpvMs    = agora - new Date(v.chegadaDt).getTime();

      let alertaClass = '', tooltipExtra = '';
      if (tpvMs >= limEst)      { alertaClass = 'alerta-estadia'; tooltipExtra = ` ⚠ ESTADIA ${formatarMs(tpvMs)}`; }
      else if (tpvMs >= limRis) { alertaClass = 'alerta-risco';   tooltipExtra = ` ⚠ RISCO ${formatarMs(tpvMs)}`; }

      const isSelecionado = vagoesSelecionados.has(v.id);

      if (modoSelecaoMultipla) {
        slot.innerHTML = `
          <div class="bolinha ${cssClass} ${alertaClass} ${isSelecionado ? 'bolinha-selecionada' : ''}"
               title="${v.id} — ${statusLabel(v.status)}${tooltipExtra}" style="cursor:pointer;"></div>
          <div class="vagao-id">${idCurto}</div>
          ${isSelecionado ? '<div class="sel-check">✓</div>' : ''}`;
        slot.classList.toggle('slot-selecionado', isSelecionado);
        slot.style.cursor = 'pointer';
        slot.addEventListener('click', () => toggleSelecaoVagao(v.id));
      } else {
        slot.innerHTML = `
          <div class="bolinha ${cssClass} ${alertaClass}"
               title="${v.id} — ${statusLabel(v.status)}${tooltipExtra}" style="cursor:pointer;"></div>
          <div class="vagao-id">${idCurto}</div>`;
        slot.querySelector('.bolinha').addEventListener('click', () => abrirModal(v.id));
      }
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }
}

// ════════════════════════════════════════
//  SELEÇÃO MÚLTIPLA
// ════════════════════════════════════════
function configurarSelecaoMultipla() {
  document.getElementById('btn-selecao-multipla').addEventListener('click', () => {
    modoSelecaoMultipla = !modoSelecaoMultipla;
    vagoesSelecionados.clear();
    atualizarBarraLote();
    renderPainelFIFO();
    const btn = document.getElementById('btn-selecao-multipla');
    if (modoSelecaoMultipla) {
      btn.textContent = '✕ Cancelar Seleção';
      btn.classList.add('btn-ativo');
    } else {
      btn.textContent = '☑ Selecionar Vários';
      btn.classList.remove('btn-ativo');
    }
  });

  document.getElementById('btn-selecionar-todos').addEventListener('click', () => {
    let vagoesFila = [];
    composicoesAtivas.forEach(comp => {
      comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status))
        .forEach(v => vagoesFila.push(v.id));
    });
    const primeiros30 = vagoesFila.slice(0, 30);
    const todosSelecionados = primeiros30.every(id => vagoesSelecionados.has(id));
    if (todosSelecionados) {
      vagoesSelecionados.clear();
    } else {
      primeiros30.forEach(id => vagoesSelecionados.add(id));
    }
    atualizarBarraLote();
    renderPainelFIFO();
  });
}

function toggleSelecaoVagao(id) {
  if (vagoesSelecionados.has(id)) vagoesSelecionados.delete(id);
  else vagoesSelecionados.add(id);
  atualizarBarraLote();
  renderPainelFIFO();
}

function atualizarBarraLote() {
  const barra   = document.getElementById('barra-lote');
  const contador = document.getElementById('lote-contador');
  if (!barra) return;
  if (modoSelecaoMultipla) {
    barra.style.display = 'flex';
    const n = vagoesSelecionados.size;
    contador.textContent = n === 0 ? 'Nenhum vagão selecionado' : `${n} vagão(ões) selecionado(s)`;
    document.getElementById('btn-alterar-lote').disabled = n === 0;
  } else {
    barra.style.display = 'none';
  }
}

// ════════════════════════════════════════
//  MODAL STATUS EM LOTE
// ════════════════════════════════════════
function configurarModalLote() {
  document.getElementById('modal-lote-fechar').addEventListener('click', fecharModalLote);
  document.getElementById('modal-lote-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-lote-overlay')) fecharModalLote();
  });

  document.querySelectorAll('.status-opt-lote').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.status-opt-lote').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      statusLoteSelecionado = opt.dataset.val;
      atualizarCamposModalLote(statusLoteSelecionado);
    });
  });

  document.getElementById('btn-alterar-lote').addEventListener('click', () => {
    if (vagoesSelecionados.size === 0) return;
    statusLoteSelecionado = null;
    document.querySelectorAll('.status-opt-lote').forEach(o => o.classList.remove('selected'));
    document.getElementById('grp-lote-posicionamento').style.display = 'none';
    document.getElementById('grp-lote-fim').style.display = 'none';
    document.getElementById('modal-lote-dt-pos').value = '';
    document.getElementById('modal-lote-dt-fim').value = '';
    document.getElementById('modal-lote-titulo').textContent =
      `Alterar ${vagoesSelecionados.size} vagão(ões)`;
    document.getElementById('modal-lote-overlay').style.display = 'flex';
  });

  document.getElementById('modal-lote-salvar').addEventListener('click', salvarStatusLote);
}

function atualizarCamposModalLote(status) {
  document.getElementById('grp-lote-posicionamento').style.display =
    ['posicionado', 'vazio', 'liberado'].includes(status) ? 'block' : 'none';
  document.getElementById('grp-lote-fim').style.display =
    ['vazio', 'liberado'].includes(status) ? 'block' : 'none';
}

async function salvarStatusLote() {
  if (!statusLoteSelecionado) { alert('Selecione um status.'); return; }

  const posDt = document.getElementById('modal-lote-dt-pos').value || null;
  const fimDt = document.getElementById('modal-lote-dt-fim').value ||
    (['liberado', 'vazio'].includes(statusLoteSelecionado) ? new Date().toISOString().slice(0, 16) : null);

  const btn = document.getElementById('modal-lote-salvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  const ids = [...vagoesSelecionados];
  const ok = await api('POST', '/atualizar-lote', {
    vagoes: ids,
    status: statusLoteSelecionado,
    posDt,
    fimDt
  });

  btn.disabled = false; btn.textContent = 'Aplicar a Todos';

  if (ok) {
    fecharModalLote();
    modoSelecaoMultipla = false;
    vagoesSelecionados.clear();
    const btnSel = document.getElementById('btn-selecao-multipla');
    btnSel.textContent = '☑ Selecionar Vários';
    btnSel.classList.remove('btn-ativo');
    atualizarBarraLote();
    alert(`Status de ${ids.length} vagão(ões) atualizado para "${statusLabel(statusLoteSelecionado)}".`);
    await carregarTudo();
  } else {
    alert('Erro ao atualizar lote. Tente novamente.');
  }
}

function fecharModalLote() {
  document.getElementById('modal-lote-overlay').style.display = 'none';
  statusLoteSelecionado = null;
}

// ════════════════════════════════════════
//  MODAL INDIVIDUAL
// ════════════════════════════════════════
function configurarModal() {
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);

  // Escopo restrito ao #vagao-modal — não conflita com .status-opt-lote
  const modal = document.getElementById('vagao-modal');
  modal.querySelectorAll('.status-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      modal.querySelectorAll('.status-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      statusSelecionado = opt.dataset.val;
      atualizarCamposModal(statusSelecionado);
    });
  });

  document.getElementById('modal-salvar').addEventListener('click', salvarStatusIndividual);
}

function atualizarCamposModal(status) {
  document.getElementById('grp-posicionamento').style.display =
    ['posicionado', 'vazio', 'liberado'].includes(status) ? 'block' : 'none';
  document.getElementById('grp-fim').style.display =
    ['vazio', 'liberado'].includes(status) ? 'block' : 'none';
}

function abrirModal(id) {
  vagaoSelecionado = id;
  let chegada = '', vagaoEncontrado = null;

  for (const comp of composicoesAtivas) {
    const v = comp.vagoes.find(v => v.id === id);
    if (v) { vagaoEncontrado = v; chegada = comp.chegadaDt; break; }
  }
  if (!vagaoEncontrado) return;

  document.getElementById('modal-vagao-id').textContent = id;
  document.getElementById('modal-vagao-chegada').textContent =
    'Chegada: ' + new Date(chegada).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  statusSelecionado = vagaoEncontrado.status;
  const modal = document.getElementById('vagao-modal');
  modal.querySelectorAll('.status-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.val === statusSelecionado));

  document.getElementById('modal-dt-pos').value = vagaoEncontrado.posDt || '';
  document.getElementById('modal-dt-fim').value = vagaoEncontrado.fimDt || '';
  atualizarCamposModal(statusSelecionado);
  document.getElementById('vagao-modal').style.display = 'flex';
}

async function salvarStatusIndividual() {
  if (!vagaoSelecionado || !statusSelecionado) return;

  const posDt = document.getElementById('modal-dt-pos').value || null;
  const fimDt = document.getElementById('modal-dt-fim').value ||
    (['liberado', 'vazio'].includes(statusSelecionado) ? new Date().toISOString().slice(0, 16) : null);

  const btn = document.getElementById('modal-salvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  const ok = await api('POST', '/atualizar-lote', {
    vagoes: [vagaoSelecionado],
    status: statusSelecionado,
    posDt,
    fimDt
  });

  btn.disabled = false; btn.textContent = 'Salvar Status';

  if (ok) { fecharModal(); await carregarTudo(); }
  else alert('Erro ao salvar. Tente novamente.');
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado  = null;
  statusSelecionado = null;
}

// ════════════════════════════════════════
//  FAROL
// ════════════════════════════════════════
function renderFarol() {
  let ativos = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status))
        ativos.push({ ...v, chegadaDt: comp.chegadaDt });
    });
  });

  const agora  = Date.now();
  const limEst = config.limite_estadia * 3600000;
  const limRis = (config.limite_estadia - 4) * 3600000;

  let maxTpvMs = 0, somaPosMs = 0, countPos = 0, somaEsperaMs = 0, countEspera = 0;
  let vagoes_estadia = [], vagoes_risco = [];

  ativos.forEach(v => {
    const tpv = agora - new Date(v.chegadaDt).getTime();
    if (tpv > maxTpvMs) maxTpvMs = tpv;
    if (tpv >= limEst)      vagoes_estadia.push({ ...v, tpvMs: tpv });
    else if (tpv >= limRis) vagoes_risco.push({ ...v, tpvMs: tpv });
    if (v.posDt) { somaPosMs    += (agora - new Date(v.posDt).getTime()); countPos++; }
    else         { somaEsperaMs += tpv; countEspera++; }
  });

  vagoes_estadia.sort((a, b) => b.tpvMs - a.tpvMs);
  vagoes_risco.sort((a, b)   => b.tpvMs - a.tpvMs);

  const backlog = ativos.length > 30 ? ativos.length - 30 : 0;

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

// ════════════════════════════════════════
//  MODAL ALERTA ESTADIA/RISCO
// ════════════════════════════════════════
function abrirModalAlerta(tipo, vagoes) {
  const isEstadia = tipo === 'estadia';
  document.getElementById('alerta-modal-titulo').textContent =
    isEstadia ? '⚠ Vagões em Estadia' : '⚠ Vagões em Risco';
  document.getElementById('alerta-modal-sub').textContent = isEstadia
    ? `${vagoes.length} vagão(ões) com mais de ${config.limite_estadia}h no pátio`
    : `${vagoes.length} vagão(ões) entre ${config.limite_estadia - 4}h e ${config.limite_estadia}h`;
  document.getElementById('alerta-modal-header').style.background = isEstadia
    ? 'linear-gradient(90deg, rgba(180,20,20,0.88), rgba(220,38,38,0.82))'
    : 'linear-gradient(90deg, rgba(140,80,0,0.88), rgba(202,138,4,0.82))';
  document.getElementById('alerta-modal-info').textContent =
    'Clique em um vagão para abrir o painel de status. Listado do mais crítico ao menos crítico.';

  document.getElementById('alerta-modal-lista').innerHTML = vagoes.map(v => {
    const dotClass = isEstadia ? 'estadia' : 'risco';
    const chegada  = new Date(v.chegadaDt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="alerta-vagao-item" onclick="fecharModalAlerta(); setTimeout(()=>abrirModal('${v.id}'),120);">
      <div class="alerta-dot ${dotClass}"></div>
      <div>
        <div class="alerta-id">${v.id}</div>
        <div class="alerta-hint">Chegada: ${chegada} · ${statusLabel(v.status)}</div>
      </div>
      <span class="alerta-tempo ${dotClass}">${formatarMs(v.tpvMs)}</span>
    </div>`;
  }).join('');

  document.getElementById('alerta-modal').style.display = 'flex';
}

function fecharModalAlerta() {
  document.getElementById('alerta-modal').style.display = 'none';
}

function toggleModoTV() {
  const overlay = document.getElementById('tv-overlay');
  const btn     = document.getElementById('btn-tv-toggle');
  if (!overlay) return;
  const aberto = overlay.style.display !== 'none';
  if (aberto) {
    overlay.style.display = 'none';
    if (btn) btn.classList.remove('btn-tv-ativo');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } else {
    renderTV();
    overlay.style.display = 'flex';
    if (btn) btn.classList.add('btn-tv-ativo');
    overlay.requestFullscreen?.().catch(() => {});
  }
}

function abrirModoTV() { toggleModoTV(); }

function fecharModoTV() {
  const overlay = document.getElementById('tv-overlay');
  const btn     = document.getElementById('btn-tv-toggle');
  if (overlay) overlay.style.display = 'none';
  if (btn) btn.classList.remove('btn-tv-ativo');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

function renderTV() {
  const agora  = Date.now();
  const limEst = (config.limite_estadia || 24) * 3600000;
  const limRis = ((config.limite_estadia || 24) - 4) * 3600000;
  let ativos = [], estourados = 0, risco = 0, maxTpv = 0;

  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status)) {
        const tpv = agora - new Date(comp.chegadaDt).getTime();
        ativos.push({ ...v, chegadaDt: comp.chegadaDt, tpvMs: tpv });
        if (tpv > maxTpv) maxTpv = tpv;
        if (tpv >= limEst) estourados++; else if (tpv >= limRis) risco++;
      }
    });
  });

  const relogio = document.getElementById('tv-relogio');
  if (relogio) relogio.textContent = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  document.getElementById('tv-tpv').textContent     = maxTpv > 0 ? formatarMs(maxTpv) : '—';
  document.getElementById('tv-estadia').textContent = estourados;
  document.getElementById('tv-risco').textContent   = risco;
  document.getElementById('tv-total').textContent   = ativos.length;

  document.getElementById('tv-farol-estadia')?.classList.toggle('alerta-estadia', estourados > 0);
  document.getElementById('tv-farol-risco')?.classList.toggle('alerta-risco', risco > 0);

  const container = document.getElementById('tv-painel');
  if (!container) return;
  container.innerHTML = '';

  const vagoesFila = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status)).forEach(v => {
      vagoesFila.push({ ...v, chegadaDt: comp.chegadaDt });
    });
  });

  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';
    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      const tpv = agora - new Date(v.chegadaDt).getTime();
      const alertaCls = tpv >= limEst ? 'alerta-estadia' : tpv >= limRis ? 'alerta-risco' : '';
      const idCurto = v.id.length > 7 ? v.id.slice(-7) : v.id;
      slot.innerHTML = `
        <div class="bolinha ${statusToCss(v.status)} ${alertaCls}" style="width:32px;height:32px;" title="${v.id}"></div>
        <div class="vagao-id" style="font-size:.55rem;">${idCurto}</div>`;
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio" style="width:32px;height:32px;"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }

  let resumosDict = {};
  composicoesAtivas.forEach(comp => {
    const n = comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status)).length;
    if (n > 0) {
      const k = formatarDataResumo(comp.chegadaDt);
      resumosDict[k] = (resumosDict[k] || 0) + n;
    }
  });

  const resumoEl = document.getElementById('tv-resumo');
  if (resumoEl) {
    resumoEl.textContent = Object.keys(resumosDict).length
      ? 'Pátio: ' + Object.keys(resumosDict).map(k => `${k} — ${resumosDict[k]} FLTs`).join(' | ')
      : 'Pátio limpo';
  }
}

document.addEventListener('click', e => {
  if (e.target === document.getElementById('alerta-modal')) fecharModalAlerta();
  if (e.target === document.getElementById('vagao-modal'))  fecharModal();
  if (e.target === document.getElementById('tv-fechar'))   fecharModoTV();
  if (e.target === document.getElementById('tv-overlay'))   fecharModoTV();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') fecharModoTV();
  if (e.key === 't' || e.key === 'T') {
    if (!e.target.matches('input, textarea, select')) toggleModoTV();
  }
});

// ════════════════════════════════════════
//  LIBERAÇÃO
// ════════════════════════════════════════
function configurarLiberacao() {
  document.getElementById('btn-gerar-form').addEventListener('click', gerarFormularioImpressao);
  document.getElementById('btn-confirmar-devolucao').addEventListener('click', confirmarDevolucaoMRS);
  const btnSelecionarTodos = document.getElementById('btn-selecionar-todos-liberacao');
  if (btnSelecionarTodos) btnSelecionarTodos.addEventListener('click', selecionarTodosLiberacao);
}

function selecionarTodosLiberacao() {
  const checkboxes = Array.from(document.querySelectorAll('.check-liberacao'));
  if (checkboxes.length === 0) return;
  const allChecked = checkboxes.every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
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

async function confirmarDevolucaoMRS() {
  const selecionados = [...document.querySelectorAll('.check-liberacao:checked')].map(cb => cb.value);
  if (selecionados.length === 0) {
    alert('Selecione ao menos um vagão para confirmar a devolução.');
    return;
  }
  if (!confirm(`Confirmar devolução de ${selecionados.length} vagão(ões) à MRS? Esta ação os removerá do pátio.`)) return;

  const ok = await api('POST', '/devolucao', { vagaoIds: selecionados });
  if (ok) {
    alert(`${selecionados.length} vagão(ões) devolvido(s) com sucesso.`);
    await carregarTudo();
  } else {
    alert('Erro ao confirmar devolução.');
  }
}

function gerarFormularioImpressao() {
  const plts = document.getElementById('lib-plts').value || '______';
  let dataLib = document.getElementById('lib-data').value;
  if (dataLib) { const [a, m, d] = dataLib.split('-'); dataLib = `${d}/${m}/${a}`; }
  else dataLib = '___/___/______';

  const checkboxes = document.querySelectorAll('.check-liberacao:checked');
  if (checkboxes.length === 0) { alert('Selecione os vagões liberados para gerar o formulário.'); return; }

  let listaHtml = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;font-size:11pt;">';
  checkboxes.forEach((cb, i) => { listaHtml += `<div><strong>${i + 1}:</strong> ${cb.value}</div>`; });
  listaHtml += '</div>';

  ['csn', 'mrs'].forEach(via => {
    document.getElementById(`imp-plts-${via}`).innerText  = plts;
    document.getElementById(`imp-data-${via}`).innerText  = dataLib;
    document.getElementById(`imp-lista-${via}`).innerHTML = listaHtml;
  });

  window.print();
}

// ════════════════════════════════════════
//  GESTÃO
// ════════════════════════════════════════
function configurarGestao() {
  document.getElementById('btn-salvar-cfg').addEventListener('click', async () => {
    const limite = parseInt(document.getElementById('cfg-limite').value) || 24;
    const ok = await api('POST', '/config', { limite_estadia: limite });
    if (ok) { config.limite_estadia = limite; alert('Configuração salva!'); renderFarol(); }
  });

  const btnAbrirTv = document.getElementById('btn-abrir-tv');
  if (btnAbrirTv) btnAbrirTv.addEventListener('click', abrirModoTV);

  document.getElementById('btn-show-add-user')?.addEventListener('click', () => {
    const p = document.getElementById('add-user-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });

  // Carrega lista de usuários quando a aba Gestão é aberta
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === 'gestao') {
      btn.addEventListener('click', carregarListaUsuarios);
    }
  });

  document.getElementById('btn-cancel-add-user')?.addEventListener('click', () => {
    document.getElementById('add-user-panel').style.display = 'none';
  });

  document.getElementById('btn-add-user')?.addEventListener('click', async () => {
    const login = document.getElementById('user-login').value.trim();
    const senha = document.getElementById('user-senha').value;
    const nivel = document.getElementById('user-nivel').value;

    if (!login || !senha) {
      alert('Preencha login e senha.');
      return;
    }

    const btn = document.getElementById('btn-add-user');
    btn.disabled = true; btn.textContent = 'Salvando…';

    // Tenta endpoint próprio do Arará primeiro; cai no endpoint do AgendaCD se não existir
    let ok = await api('POST', '/usuarios', { nome: login, senha, nivel });

    if (!ok) {
      // Fallback: rota /usuarios do AgendaCD (Basic Auth)
      try {
        const res = await fetch('/usuarios', {
          method: 'POST',
          headers: getBasicAuthHeader(),
          body: JSON.stringify({ nome: login, senha, perfil: nivel === 'admin' ? 'admin' : nivel === 'view' ? 'operacao' : nivel })
        });
        ok = res.ok ? await res.json() : null;
      } catch (e) { ok = null; }
    }

    if (!ok) {
      // Fallback: rota /usuarios do AgendaCD (Basic Auth)
      try {
        const res = await fetch('/usuarios', {
          method: 'POST',
          headers: getBasicAuthHeader(),
          body: JSON.stringify({ nome: login, senha, perfil: nivel === 'admin' ? 'admin' : nivel === 'view' ? 'operacao' : nivel })
        });
        ok = res.ok ? await res.json() : null;
      } catch (e) { ok = null; }
    }

    btn.disabled = false; btn.textContent = 'Adicionar Usuário';

    if (ok) {
      alert(`Usuário "${login}" cadastrado com sucesso!`);
      document.getElementById('user-login').value = '';
      document.getElementById('user-senha').value = '';
      document.getElementById('add-user-panel').style.display = 'none';
      carregarListaUsuarios();
    } else {
      alert('Erro ao cadastrar usuário. Verifique se você tem permissão de administrador.');
    }
  });
}

async function carregarListaUsuarios() {
  const listEl = document.getElementById('user-list');
  if (!listEl) return;

  // Tenta endpoint do Arará, depois do AgendaCD
  let usuarios = await api('GET', '/usuarios');
  if (!usuarios) {
    try {
      const res = await fetch('/usuarios', { method: 'GET', headers: getBasicAuthHeader() });
      usuarios = res.ok ? await res.json() : null;
    } catch (e) { usuarios = null; }
  }

  if (!Array.isArray(usuarios) || usuarios.length === 0) {
    listEl.innerHTML = '<p class="info-text" style="margin:0;">Nenhum usuário cadastrado ou sem permissão para listar.</p>';
    return;
  }

  const nivelLabel = { operacao: 'Operação', portaria: 'Portaria', relatorio: 'Relatório', admin: 'Administrador' };
  listEl.innerHTML = usuarios.map(u => `
    <div class="user-item" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.07);">
      <div>
        <strong>@${u.nome}</strong>
      </div>
      <span class="modal-vagao-badge">${nivelLabel[u.perfil] || u.perfil || '—'}</span>
    </div>
  `).join('');
}

// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function statusToCss(s) {
  return { nao_posicionado: 'nao_posicionado', posicionado: 'posicionado', vazio: 'vazio', liberado: 'liberado_aguardando' }[s] || 'vazio';
}

function statusLabel(s) {
  return { nao_posicionado: 'Não Posicionado', posicionado: 'Posicionado', vazio: 'Vazio', liberado: 'Liberado' }[s] || s;
}

function formatarDataResumo(dtString) {
  const dt    = new Date(dtString);
  const dia   = String(dt.getDate()).padStart(2, '0');
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dia}/${meses[dt.getMonth()]}`;
}

function formatarMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
}

window.onload = init;
