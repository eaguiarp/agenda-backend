// ============================================================
// public/arara/script.js — versão com backend PostgreSQL
// Substitui o localStorage por chamadas à API /api/vagoes/*
// ============================================================

// ── CONFIGURAÇÃO ──
// Credenciais do usuário logado (integrar com o sistema de login
// do AgendaCD-PWA futuramente; por ora, pede no primeiro acesso)
let AUTH = { usuario: '', senha: '' };

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'usuario': AUTH.usuario,
    'senha':   AUTH.senha
  };
}

async function api(method, path, body) {
  try {
    let endpoint = path;
    if (!path.startsWith('/')) endpoint = '/' + path;
    const url = endpoint.startsWith('/api') ? endpoint : '/api/vagoes' + endpoint;

    console.log('Chamando:', method, url); // Debug

    const res = await fetch(url, {
      method,
      headers: getHeaders(),
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 401 || res.status === 403) {
      pedirLogin();
      return null;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.erro || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    console.error('[api]', method, path, e);
    return null;
  }
}

// ── LOGIN SIMPLES ──
function pedirLogin() {
  const u = prompt('Usuário:');
  const s = prompt('Senha:');
  if (u && s) {
    AUTH = { usuario: u, senha: s };
    localStorage.setItem('arara_auth', JSON.stringify(AUTH));
    init();
  }
}

// ── ESTADO LOCAL (cache da API) ──
let composicoesAtivas = [];
let config  = { limite_estadia: 24 };
let usuarios = [];
let logEntradas = [];
let vagaoSelecionado  = null;
let statusSelecionado = null;
let modoSelecaoLote = false;
let vagoesSelecionadosLote = []; // Guardará os IDs selecionados
let motivoEstadiaPendente = null;

const STATUS_VISIVEIS = ['nao_posicionado', 'posicionado', 'vazio', 'liberado'];

// ════════════════════════════════════════
//  INIT REVISADO
// ════════════════════════════════════════
async function init() {
  // Pega credenciais salvas se houver
  const u = localStorage.getItem('arara_user');
  const s = localStorage.getItem('arara_pass');
  if (u && s) AUTH = { usuario: u, senha: s };

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLiberacao();
  configurarGestao();
  configurarBusca();        // ← ADICIONE ESTA LINHA
  configurarTeclas();       // ← ADICIONE ESTA LINHA

  document.getElementById('alerta-modal-fechar').addEventListener('click', fecharModalAlerta);

  // Corrigir: usar carregarTudo() em vez de atualizarDados()
  await carregarTudo();     // ← Mude de atualizarDados() para carregarTudo()
  
  setInterval(carregarTudo, 10000);  // ← Mude também aqui
  
  // Relógio em tempo real na barra superior
  setInterval(atualizarRelogio, 1000);
}

async function carregarTudo() {
  const [comps, cfg, log] = await Promise.all([
    api('GET', '/composicoes'),
    api('GET', '/config'),
    api('GET', '/log?limite=100')
  ]);

  if (comps) composicoesAtivas = comps;
  if (cfg)   config = cfg;
  if (log)   logEntradas = log.map(e => ({
    ts:              e.criado_em,
    vagaoId:         e.vagao_id,
    statusAnterior:  e.status_anterior,
    statusNovo:      e.status_novo,
    motivo:          e.motivo,
    usuario:         e.usuario
  }));

  document.getElementById('cfg-limite').value = config.limite_estadia;
  atualizarInterface();
}

function atualizarInterface() {
  atualizarRelogio();
  renderPainelFIFO();
  renderFarol();
  renderLiberacao();
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
    if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
    const modaisAbertos = document.querySelector('.modal-overlay[style*="flex"]');
    if (modaisAbertos) {
      if (e.key === 'Escape') { fecharModal(); fecharModalAlerta();
        if (document.getElementById('tv-overlay').style.display !== 'none') fecharModoTV(); }
      return;
    }
    switch(e.key.toLowerCase()) {
      case 'n': irParaAba('painel');
        setTimeout(() => document.getElementById('comp-vagoes').focus(), 100); break;
      case 'l': irParaAba('liberacao'); break;
      case 'g': irParaAba('gestao');    break;
      case 't': abrirModoTV();          break;
      case '/': e.preventDefault(); document.getElementById('busca-vagao').focus(); break;
    }
  });
}

// ════════════════════════════════════════
//  BUSCA RÁPIDA
// ════════════════════════════════════════
function configurarBusca() {
  const input = document.getElementById('busca-vagao');
  if (!input) return;
  input.addEventListener('input', () => highlightBusca(input.value.trim().toUpperCase()));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; highlightBusca(''); input.blur(); }
    if (e.key === 'Enter' && input.value.trim()) abrirModal(input.value.trim().toUpperCase());
  });
}

function highlightBusca(q) {
  document.querySelectorAll('.vagao-slot-fifo').forEach(slot => {
    const bolinha = slot.querySelector('.bolinha');
    if (!bolinha || bolinha.classList.contains('slot-vazio')) return;
    const id = bolinha.getAttribute('data-id') || '';
    if (q && id.includes(q)) {
      slot.style.opacity = '1'; slot.style.transform = 'scale(1.2)';
      bolinha.style.outline = '2.5px solid #fff';
    } else if (q) {
      slot.style.opacity = '0.25'; slot.style.transform = ''; bolinha.style.outline = '';
    } else {
      slot.style.opacity = ''; slot.style.transform = ''; bolinha.style.outline = '';
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
  document.getElementById('btn-nova-comp').addEventListener('click', async () => {
    const data  = document.getElementById('comp-data').value;
    const hora  = document.getElementById('comp-hora').value;
    const texto = document.getElementById('comp-vagoes').value;
    if (!data || !hora || !texto.trim()) { alert('Preencha data, hora e os IDs dos vagões.'); return; }

    const ids = texto.split(/[\n,]+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0);
    const btn = document.getElementById('btn-nova-comp');
    btn.disabled = true; btn.textContent = 'Registrando…';

    const resultado = await api('POST', '/composicoes', { chegadaDt: `${data}T${hora}`, vagoes: ids });
    btn.disabled = false; btn.textContent = 'Registrar Composição';

    if (resultado) {
      document.getElementById('comp-vagoes').value = '';
      alert(`${ids.length} vagão(ões) inserido(s) no pátio.`);
      await carregarTudo();
    }

    // ── ESCOUTAS PARA SELEÇÃO EM LOTE ──
  const btnModo = document.getElementById('btn-modo-selecao');
  btnModo?.addEventListener('click', () => {
    modoSelecaoLote = !modoSelecaoLote;
    if (modoSelecaoLote) {
      btnModo.classList.add('ativo');
      btnModo.innerText = '✕ Cancelar Seleção';
    } else {
      cancelarSelecaoLote();
    }
  });

  document.getElementById('btn-lote-cancelar')?.addEventListener('click', cancelarSelecaoLote);

  document.getElementById('btn-lote-salvar')?.addEventListener('click', async () => {
    if (vagoesSelecionadosLote.length === 0) return;
    const novoStatus = document.getElementById('lote-novo-status').value;
    
    // Dispara a atualização em massa para o Backend PostgreSQL
    const sucesso = await api('POST', '/atualizar-lote', {
      vagoes: vagoesSelecionadosLote,
      status: novoStatus
    });

    if (sucesso) {
      alert('Lote atualizado com sucesso!');
      cancelarSelecaoLote();
      // Recarrega os dados atualizados do banco Railway
      const dados = await api('GET', '/ativos');
      if (dados) renderPainel(dados);
    } else {
      alert('Erro ao atualizar lote.');
    }
  });


  });
}

// ════════════════════════════════════════
//  PAINEL FIFO REVISADO
// ════════════════════════════════════════
function renderPainelFIFO(vagoes) {
  const container = document.getElementById('painel-vagoes-fifo');
  const resumo = document.getElementById('patio-resumo');
  if (!container) return;
  container.innerHTML = '';

  // Filtra vagões ativos (vazio continua no pátio, liberado some)
  const ativos = vagoes.filter(v => v.status !== 'liberado');

  if (ativos.length === 0) {
    if (resumo) resumo.textContent = 'Pátio Atual: Limpo (Sem operações ativas)';
  } else {
    const resumosDict = {};
    ativos.forEach(v => {
      const chave = formatarDataResumo(v.chegada_dt);
      resumosDict[chave] = (resumosDict[chave] || 0) + 1;
    });
    const stringResumo = Object.keys(resumosDict).map(k => `[${k} — ${resumosDict[k]} FLTs]`).join(' ');
    if (resumo) resumo.textContent = `Pátio Atual: ${stringResumo}`;
  }

  // Monta rigorosamente os 30 slots fixos na tela (Grid FIFO)
  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';

    if (i < ativos.length) {
      const v = ativos[i];
      const estaSelecionado = vagoesSelecionadosLote.includes(v.vagao_id);
      
      slot.innerHTML = `
        <div class="bolinha ${v.status} ${estaSelecionado ? 'selecionada' : ''}" data-id="${v.vagao_id}" title="${v.vagao_id}" style="cursor:pointer;"></div>
        <div class="vagao-id">${v.vagao_id}</div>
      `;

      // Clique inteligente na bolinha
      slot.querySelector('.bolinha').addEventListener('click', (e) => {
        if (modoSelecaoLote) {
          if (vagoesSelecionadosLote.includes(v.vagao_id)) {
            vagoesSelecionadosLote = vagoesSelecionadosLote.filter(id => id !== v.vagao_id);
            e.target.classList.remove('selecionada');
          } else {
            vagoesSelecionadosLote.push(v.vagao_id);
            e.target.classList.add('selecionada');
          }
          atualizarBarraFlutuanteLote();
        } else {
          // Garante a abertura correta passando o ID sequencial do banco primeiro
          abrirModal(v.id, v.vagao_id, v.status, v.pos_dt, v.fim_dt);
        }
      });
    } else {
      // Slot invisível/desativado para manter simetria perfeita de 30 posições
      slot.innerHTML = `
        <div class="bolinha slot-vazio"></div>
        <div class="vagao-id"></div>
      `;
    }
    container.appendChild(slot);
  }
}

// ════════════════════════════════════════
//  SELEÇÃO EM LOTE
// ════════════════════════════════════════
function atualizarBarraFlutuanteLote() {
  const barra = document.getElementById('barra-lote-flutuante');
  if (!barra) return;

  if (vagoesSelecionadosLote.length > 0) {
    barra.style.display = 'flex';
    const txtContador = document.getElementById('lote-contador');
    if (txtContador) {
      txtContador.innerText = `${vagoesSelecionadosLote.length} vagão(ões) selecionado(s)`;
    }
  } else {
    barra.style.display = 'none';
  }
}

function cancelarSelecaoLote() {
  modoSelecaoLote = false;
  vagoesSelecionadosLote = [];
  const btnModo = document.getElementById('btn-modo-selecao');
  if (btnModo) {
    btnModo.classList.remove('ativo');
    btnModo.innerText = '▢ Seleção Múltipla';
  }
  const barra = document.getElementById('barra-lote-flutuante');
  if (barra) barra.style.display = 'none';
  
  // Remove as classes de brilho selecionado visualmente das bolinhas
  document.querySelectorAll('.bolinha.selecionada').forEach(el => el.classList.remove('selecionada'));
}

function statusToCss(s) {
  return {nao_posicionado:'nao_posicionado',posicionado:'posicionado',vazio:'vazio',liberado:'liberado_aguardando'}[s]||'vazio';
}
function statusLabel(s) {
  return {nao_posicionado:'Não Posicionado',posicionado:'Posicionado',vazio:'Vazio',liberado:'Liberado'}[s]||s;
}
function formatarDataResumo(dtString) {
  const dt = new Date(dtString);
  return `${String(dt.getDate()).padStart(2,'0')}/${ ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][dt.getMonth()] }`;
}
function formatarMs(ms) {
  return `${String(Math.floor(ms/3600000)).padStart(2,'0')}h ${String(Math.floor((ms%3600000)/60000)).padStart(2,'0')}m`;
}

// ════════════════════════════════════════
//  MODAL VAGÃO
// ════════════════════════════════════════
const MOTIVOS_ESTADIA = [
  'Aguardando manobra MRS','Problema mecânico no vagão',
  'Fila de carregamento','Aguardando documento/NF',
  'Operação suspensa','Outro'
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

async function salvarStatusVagao() {
  if (!vagaoSelecionado || !statusSelecionado) return;

  const res = encontrarVagao(vagaoSelecionado);
  if (res) {
    const tpvMs = Date.now() - new Date(res.comp.chegadaDt).getTime();
    if (tpvMs >= config.limite_estadia * 3600000 && !motivoEstadiaPendente) {
      abrirModalMotivo(); return;
    }
  }

  const vagao = res?.vagao;
  if (!vagao?._dbId) return;

  const btn = document.getElementById('modal-salvar');
  btn.disabled = true; btn.textContent = 'Salvando…';

  const ok = await api('PATCH', `/${vagao._dbId}/status`, {
    status:  statusSelecionado,
    posDt:   document.getElementById('modal-dt-pos').value || null,
    fimDt:   document.getElementById('modal-dt-fim').value || null,
    motivo:  motivoEstadiaPendente || null
  });

  btn.disabled = false; btn.textContent = 'Salvar Status';
  motivoEstadiaPendente = null;

  if (ok) { fecharModal(); await carregarTudo(); }
}

function abrirModalMotivo() {
  const sel = document.getElementById('motivo-select');
  sel.innerHTML = MOTIVOS_ESTADIA.map(m => `<option>${m}</option>`).join('');
  document.getElementById('motivo-modal').style.display = 'flex';
}

function configurarModalMotivo() {
  document.getElementById('motivo-confirmar').addEventListener('click', () => {
    const sel    = document.getElementById('motivo-select').value;
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
    document.getElementById('grp-motivo-custom').style.display = e.target.value === 'Outro' ? 'block' : 'none';
  });
}

function atualizarCamposModal(status) {
  document.getElementById('grp-posicionamento').style.display =
    (['posicionado','vazio','liberado'].includes(status)) ? 'block' : 'none';
  document.getElementById('grp-fim').style.display =
    (['vazio','liberado'].includes(status)) ? 'block' : 'none';
}

function abrirModal(id) {
  const res = encontrarVagao(id);
  if (!res) return;
  vagaoSelecionado  = id;
  motivoEstadiaPendente = null;
  const { vagao, comp } = res;

  const tpvMs = Date.now() - new Date(comp.chegadaDt).getTime();
  document.getElementById('modal-vagao-id').textContent = id;
  document.getElementById('modal-vagao-chegada').textContent =
    'Chegada: ' + new Date(comp.chegadaDt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
    + ' · TPV: ' + formatarMs(tpvMs);

  statusSelecionado = vagao.status;
  document.querySelectorAll('.status-opt').forEach(o =>
    o.classList.toggle('selected', o.dataset.val === statusSelecionado));

  document.getElementById('modal-dt-pos').value = vagao.posDt || '';
  document.getElementById('modal-dt-fim').value = vagao.fimDt || '';
  atualizarCamposModal(statusSelecionado);
  document.getElementById('vagao-modal').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado = statusSelecionado = motivoEstadiaPendente = null;
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
    if (v.posDt) { somaPosMs   += agora - new Date(v.posDt).getTime(); countPos++;    }
    else         { somaEsperaMs += tpv;                                  countEspera++; }
  });

  vagoes_estadia.sort((a,b) => b.tpvMs - a.tpvMs);
  vagoes_risco.sort((a,b)   => b.tpvMs - a.tpvMs);

  document.getElementById('val-tpv').innerText     = maxTpvMs > 0 ? formatarMs(maxTpvMs) : '—';
  document.getElementById('val-pos').innerText     = countPos > 0 ? formatarMs(somaPosMs/countPos) : '—';
  document.getElementById('val-espera').innerText  = countEspera > 0 ? formatarMs(somaEsperaMs/countEspera) : '—';
  document.getElementById('val-estadia').innerText = vagoes_estadia.length;
  document.getElementById('val-risco').innerText   = vagoes_risco.length;
  document.getElementById('val-backlog').innerText = Math.max(0, ativos.length - 30);

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
//  MODAL ALERTA
// ════════════════════════════════════════
function abrirModalAlerta(tipo, vagoes) {
  const isEst  = tipo === 'estadia';
  document.getElementById('alerta-modal-titulo').textContent =
    isEst ? '⚠ Vagões em Estadia' : '⚠ Vagões em Risco';
  document.getElementById('alerta-modal-sub').textContent = isEst
    ? `${vagoes.length} vagão(ões) com mais de ${config.limite_estadia}h no pátio`
    : `${vagoes.length} vagão(ões) entre ${config.limite_estadia-4}h e ${config.limite_estadia}h`;
  document.getElementById('alerta-modal-header').style.background = isEst
    ? 'linear-gradient(90deg,rgba(180,20,20,.88),rgba(220,38,38,.82))'
    : 'linear-gradient(90deg,rgba(140,80,0,.88),rgba(202,138,4,.82))';
  document.getElementById('alerta-modal-info').textContent =
    'Clique num vagão para abrir o painel de status. Ordenado do mais crítico ao menos crítico.';
  document.getElementById('alerta-modal-lista').innerHTML = vagoes.map(v => {
    const dc = isEst ? 'estadia' : 'risco';
    const ch = new Date(v.chegadaDt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
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
function abrirModoTV() { renderTV(); document.getElementById('tv-overlay').style.display = 'flex'; }
function fecharModoTV() { document.getElementById('tv-overlay').style.display = 'none'; }

function renderTV() {
  const agora  = Date.now();
  const limEst = config.limite_estadia * 3600000;
  const limRis = (config.limite_estadia - 4) * 3600000;
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

  document.getElementById('tv-relogio').textContent =
    new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  document.getElementById('tv-tpv').textContent     = maxTpv > 0 ? formatarMs(maxTpv) : '—';
  document.getElementById('tv-estadia').textContent = estourados;
  document.getElementById('tv-risco').textContent   = risco;
  document.getElementById('tv-total').textContent   = ativos.length;

  document.getElementById('tv-farol-estadia').classList.toggle('alerta-estadia', estourados > 0);
  document.getElementById('tv-farol-risco').classList.toggle('alerta-risco',     risco > 0);

  const container = document.getElementById('tv-painel');
  container.innerHTML = '';
  let vagoesFila = [];
  composicoesAtivas.forEach(comp =>
    comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status))
      .forEach(v => vagoesFila.push({ ...v, chegadaDt: comp.chegadaDt })));

  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';
    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      const tpv = agora - new Date(v.chegadaDt).getTime();
      let alertaCls = tpv >= limEst ? 'alerta-estadia' : tpv >= limRis ? 'alerta-risco' : '';
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
    if (n > 0) { const k = formatarDataResumo(comp.chegadaDt); resumosDict[k] = (resumosDict[k]||0)+n; }
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
          <input type="checkbox" class="check-liberacao" value="${v._dbId}" data-nome="${v.id}">
          <span class="lib-id">${v.id}</span>
          <span class="lib-status-badge">✓ Liberado</span>
        </label>`;
      }
    });
  });
  div.innerHTML = html || '<div class="vazio-msg">Mude o status de um vagão para "Liberado" no painel para que ele apareça aqui.</div>';
}

async function confirmarDevolucaoMRS() {
  const cbs = [...document.querySelectorAll('.check-liberacao:checked')];
  if (!cbs.length) { alert('Selecione ao menos um vagão.'); return; }
  const nomes = cbs.map(cb => cb.dataset.nome).join(', ');
  if (!confirm(`Confirmar devolução de ${cbs.length} vagão(ões) à MRS?\n${nomes}\n\nEles serão removidos do pátio.`)) return;

  const vagaoDbIds = cbs.map(cb => parseInt(cb.value));
  const ok = await api('POST', '/devolucao', { vagaoDbIds });
  if (ok) {
    alert(`${cbs.length} vagão(ões) devolvido(s) com sucesso.`);
    await carregarTudo();
  }
}

function gerarFormularioImpressao() {
  const plts = document.getElementById('lib-plts').value || '______';
  let dataLib = document.getElementById('lib-data').value;
  if (dataLib) { const [a,m,d] = dataLib.split('-'); dataLib = `${d}/${m}/${a}`; }
  else dataLib = '___/___/______';
  const cbs = document.querySelectorAll('.check-liberacao:checked');
  if (!cbs.length) { alert('Selecione os vagões para gerar o formulário.'); return; }
  let listaHtml = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px;font-size:11pt;">';
  cbs.forEach((cb, i) => { listaHtml += `<div><strong>${i+1}:</strong> ${cb.dataset.nome}</div>`; });
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
  if (!logEntradas.length) { div.innerHTML = '<div class="vazio-msg">Nenhuma movimentação registrada.</div>'; return; }
  div.innerHTML = logEntradas.slice(0,100).map(e => {
    const dt  = new Date(e.ts).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    const ant = e.statusAnterior ? statusLabel(e.statusAnterior) : 'Entrada';
    const nov = e.statusNovo === 'devolvido' ? 'Devolvido MRS' : statusLabel(e.statusNovo);
    const mot = e.motivo ? `<span class="log-motivo">${e.motivo}</span>` : '';
    return `<div class="log-item">
      <div class="log-dt">${dt}</div>
      <div class="log-id">${e.vagaoId}</div>
      <div class="log-transicao">${ant} → ${nov}${mot}</div>
    </div>`;
  }).join('');
}

async function exportarCSV() {
  const dados = await api('GET', '/log?limite=500');
  if (!dados?.length) { alert('Nenhum dado para exportar.'); return; }
  const header = ['Data/Hora','Vagão','Status Anterior','Status Novo','Motivo','Usuário'];
  const linhas = dados.map(e => [
    new Date(e.criado_em).toLocaleString('pt-BR'),
    e.vagao_id, e.status_anterior||'Entrada', e.status_novo, e.motivo||'', e.usuario||''
  ].map(c => `"${c}"`).join(';'));
  const blob = new Blob(['\uFEFF'+[header.join(';'),...linhas].join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `arara_log_${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}

// ════════════════════════════════════════
//  GESTÃO
// ════════════════════════════════════════
function configurarGestao() {
  document.getElementById('btn-salvar-cfg').addEventListener('click', async () => {
    const limite = parseInt(document.getElementById('cfg-limite').value) || 24;
    const ok = await api('PATCH', '/config', { limite_estadia: limite });
    if (ok) { config.limite_estadia = limite; alert('Configuração salva!'); renderFarol(); }
  });

  document.getElementById('btn-show-add-user').addEventListener('click', () => {
    const p = document.getElementById('add-user-panel');
    p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-cancel-add-user').addEventListener('click', () => {
    document.getElementById('add-user-panel').style.display = 'none'; limparFormUser();
  });
  // Usuários: continua usando a tabela 'usuarios' existente do AgendaCD
  // O gerenciamento de usuários fica no sistema principal — aqui só exibe
  document.getElementById('btn-add-user')?.addEventListener('click', () => {
    alert('O cadastro de usuários é gerenciado pelo sistema principal (AgendaCD).\nOs mesmos usuários já têm acesso ao módulo de vagões.');
  });

  document.getElementById('btn-exportar-csv')?.addEventListener('click', exportarCSV);
  document.getElementById('btn-abrir-tv')?.addEventListener('click', abrirModoTV);

  configurarModalMotivo();
  renderUsuarios();
}

function limparFormUser() {
  ['user-nome','user-login','user-senha'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
}

function renderUsuarios() {
  // Exibe mensagem informando que usuários vêm do sistema principal
  const div = document.getElementById('user-list');
  if (!div) return;
  div.innerHTML = `<div class="user-item" style="opacity:.7;">
    <div class="user-avatar">👥</div>
    <div class="user-info">
      <div class="user-name">Usuários do AgendaCD</div>
      <div class="user-login">Os mesmos usuários do sistema principal têm acesso aqui</div>
    </div>
  </div>`;
}

window.onload = init;
