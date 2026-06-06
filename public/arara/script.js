const STORAGE_KEY  = 'arara_vagoes_ativos_v3';
const STORAGE_CFG  = 'arara_config_v3';
const STORAGE_USERS = 'arara_users_v1';

let composicoesAtivas = [];
let config = { limite_estadia: 24 };
let usuarios = [];
let vagaoSelecionado = null;
let statusSelecionado = null;
let modoSelecaoMultipla = false;
let vagoesSelecionados = new Set(); // IDs selecionados no modo múltiplo
let statusLoteSelecionado = null;

// ── INIT ──
function init() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) composicoesAtivas = JSON.parse(salvo);

  const cfgSalvo = localStorage.getItem(STORAGE_CFG);
  if (cfgSalvo) config = { ...config, ...JSON.parse(cfgSalvo) };

  const usersSalvo = localStorage.getItem(STORAGE_USERS);
  if (usersSalvo) {
    usuarios = JSON.parse(usersSalvo);
  } else {
    // Usuário padrão admin
    usuarios = [{ id: 1, nome: 'Administrador', login: 'admin', senha: '1234', nivel: 'admin' }];
    salvarUsuarios();
  }

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLiberacao();
  configurarGestao();

  configurarSelecaoMultipla();
  configurarModalLote();
  document.getElementById('alerta-modal-fechar').addEventListener('click', fecharModalAlerta);

  document.getElementById('cfg-limite').value = config.limite_estadia;

  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('comp-data').value = hoje;
  document.getElementById('lib-data').value = hoje;

  atualizarInterface();
  setInterval(() => {
    atualizarRelogio();
    renderFarol();
  }, 1000);
}

function salvarDados() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(composicoesAtivas));
  atualizarInterface();
}

function salvarUsuarios() {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(usuarios));
}

function atualizarInterface() {
  atualizarRelogio();
  renderPainelFIFO();
  renderFarol();
  renderLiberacao();
  renderUsuarios();
}

// ── RELÓGIO ──
function atualizarRelogio() {
  const agora = new Date();
  document.getElementById('relogio').textContent =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ── ABAS ──
function configurarAbas() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── REGISTRO DE COMPOSIÇÃO ──
function configurarFormComposicao() {
  document.getElementById('btn-nova-comp').addEventListener('click', () => {
    const data  = document.getElementById('comp-data').value;
    const hora  = document.getElementById('comp-hora').value;
    const texto = document.getElementById('comp-vagoes').value;

    if (!data || !hora || !texto.trim()) {
      alert('Preencha data, hora e os IDs dos vagões.');
      return;
    }

    const ids = texto.split(/[\n,]+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0);

    composicoesAtivas.push({
      chegadaDt: `${data}T${hora}`,
      vagoes: ids.map(id => ({ id, status: 'nao_posicionado', posDt: null, fimDt: null }))
    });

    salvarDados();
    document.getElementById('comp-vagoes').value = '';
    alert(`${ids.length} vagão(ões) inserido(s) no pátio.`);
  });
}

// ── PAINEL FIFO ──
// Status que aparecem no painel (tudo exceto 'devolvido' — que remove o vagão)
const STATUS_VISIVEIS = ['nao_posicionado', 'posicionado', 'vazio', 'liberado'];

function renderPainelFIFO() {
  const container = document.getElementById('painel-vagoes-fifo');
  const resumo    = document.getElementById('patio-resumo');
  container.innerHTML = '';

  let vagoesFila = [];
  let resumosDict = {};

  composicoesAtivas.forEach(comp => {
    // Vagões visíveis = todos exceto devolvidos
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
    const partes = Object.keys(resumosDict).map(k => `${k} — ${resumosDict[k]} FLTs`);
    resumo.textContent = 'Pátio: ' + partes.join(' | ');
  }

  // 30 slots visíveis + backlog
  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';

    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      const cssClass = statusToCss(v.status);
      const idCurto  = v.id.length > 7 ? v.id.slice(-7) : v.id;

      const tpvMs = Date.now() - new Date(v.chegadaDt).getTime();
      const limiteEstadia = config.limite_estadia * 3600000;
      const limiteRisco   = (config.limite_estadia - 4) * 3600000;
      let alertaClass = '';
      let tooltipExtra = '';
      if (tpvMs >= limiteEstadia) {
        alertaClass  = 'alerta-estadia';
        tooltipExtra = ` ⚠ ESTADIA ${formatarMs(tpvMs)}`;
      } else if (tpvMs >= limiteRisco) {
        alertaClass  = 'alerta-risco';
        tooltipExtra = ` ⚠ RISCO ${formatarMs(tpvMs)}`;
      }

      const isSelecionado = vagoesSelecionados.has(v.id);

      if (modoSelecaoMultipla) {
        slot.innerHTML = `
          <div class="bolinha ${cssClass} ${alertaClass} ${isSelecionado ? 'bolinha-selecionada' : ''}"
               title="${v.id} — ${statusLabel(v.status)}${tooltipExtra}" style="cursor:pointer;"></div>
          <div class="vagao-id">${idCurto}</div>
          ${isSelecionado ? '<div class="sel-check">✓</div>' : ''}
        `;
        slot.classList.toggle('slot-selecionado', isSelecionado);
        slot.style.cursor = 'pointer';
        slot.addEventListener('click', () => toggleSelecaoVagao(v.id));
      } else {
        slot.innerHTML = `
          <div class="bolinha ${cssClass} ${alertaClass}" title="${v.id} — ${statusLabel(v.status)}${tooltipExtra}" style="cursor:pointer;"></div>
          <div class="vagao-id">${idCurto}</div>
        `;
        slot.querySelector('.bolinha').addEventListener('click', () => abrirModal(v.id));
      }
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }
}

function statusToCss(status) {
  const map = {
    nao_posicionado:    'nao_posicionado',
    posicionado:        'posicionado',
    vazio:              'vazio',
    liberado:           'liberado_aguardando',
  };
  return map[status] || 'vazio';
}

function statusLabel(status) {
  const map = {
    nao_posicionado: 'Não Posicionado',
    posicionado:     'Posicionado',
    vazio:           'Vazio',
    liberado:        'Liberado',
  };
  return map[status] || status;
}

function formatarDataResumo(dtString) {
  const dt = new Date(dtString);
  const dia = String(dt.getDate()).padStart(2, '0');
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dia}/${meses[dt.getMonth()]}`;
}

// ── MODAL ──
function configurarModal() {
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);

  // Clique nas opções de status
  document.querySelectorAll('.status-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.status-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      statusSelecionado = opt.dataset.val;
      atualizarCamposModal(statusSelecionado);
    });
  });

  document.getElementById('modal-salvar').addEventListener('click', () => {
    if (!vagaoSelecionado || !statusSelecionado) return;

    for (const comp of composicoesAtivas) {
      const vagao = comp.vagoes.find(v => v.id === vagaoSelecionado);
      if (vagao) {
        vagao.status = statusSelecionado;
        vagao.posDt  = document.getElementById('modal-dt-pos').value || null;
        if (statusSelecionado === 'liberado' || statusSelecionado === 'vazio') {
          vagao.fimDt = document.getElementById('modal-dt-fim').value || new Date().toISOString().slice(0,16);
        } else {
          vagao.fimDt = null;
        }
        // Se "liberado" (devolvido à MRS) → remove definitivamente
        if (statusSelecionado === 'devolvido') {
          comp.vagoes = comp.vagoes.filter(v => v.id !== vagaoSelecionado);
        }
        break;
      }
    }
    // Remove composições totalmente vazias
    composicoesAtivas = composicoesAtivas.filter(c => c.vagoes.length > 0);

    fecharModal();
    salvarDados();
  });
}

function atualizarCamposModal(status) {
  const grpPos = document.getElementById('grp-posicionamento');
  const grpFim = document.getElementById('grp-fim');
  grpPos.style.display = (status === 'posicionado' || status === 'vazio' || status === 'liberado') ? 'block' : 'none';
  grpFim.style.display  = (status === 'vazio' || status === 'liberado') ? 'block' : 'none';
}

function abrirModal(id) {
  vagaoSelecionado = id;
  let chegada = '';
  let vagaoEncontrado = null;

  for (const comp of composicoesAtivas) {
    const v = comp.vagoes.find(v => v.id === id);
    if (v) { vagaoEncontrado = v; chegada = comp.chegadaDt; break; }
  }
  if (!vagaoEncontrado) return;

  document.getElementById('modal-vagao-id').textContent = id;
  document.getElementById('modal-vagao-chegada').textContent =
    'Chegada: ' + new Date(chegada).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });

  // Seleciona opção atual
  statusSelecionado = vagaoEncontrado.status;
  document.querySelectorAll('.status-opt').forEach(o => {
    o.classList.toggle('selected', o.dataset.val === statusSelecionado);
  });

  document.getElementById('modal-dt-pos').value = vagaoEncontrado.posDt || '';
  document.getElementById('modal-dt-fim').value = vagaoEncontrado.fimDt || '';
  atualizarCamposModal(statusSelecionado);

  document.getElementById('vagao-modal').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado = null;
  statusSelecionado = null;
}

// ── SELEÇÃO MÚLTIPLA ──
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
      comp.vagoes.filter(v => STATUS_VISIVEIS.includes(v.status)).forEach(v => {
        vagoesFila.push(v.id);
      });
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
  if (vagoesSelecionados.has(id)) {
    vagoesSelecionados.delete(id);
  } else {
    vagoesSelecionados.add(id);
  }
  atualizarBarraLote();
  renderPainelFIFO();
}

function atualizarBarraLote() {
  const barra = document.getElementById('barra-lote');
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

// ── MODAL DE STATUS EM LOTE ──
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
    document.getElementById('modal-lote-overlay').style.display = 'flex';
    document.getElementById('modal-lote-titulo').textContent =
      `Alterar ${vagoesSelecionados.size} vagão(ões)`;
  });

  document.getElementById('modal-lote-salvar').addEventListener('click', salvarStatusLote);
}

function atualizarCamposModalLote(status) {
  document.getElementById('grp-lote-posicionamento').style.display =
    (status === 'posicionado' || status === 'vazio' || status === 'liberado') ? 'block' : 'none';
  document.getElementById('grp-lote-fim').style.display =
    (status === 'vazio' || status === 'liberado') ? 'block' : 'none';
}

function salvarStatusLote() {
  if (!statusLoteSelecionado) { alert('Selecione um status.'); return; }
  const posDt = document.getElementById('modal-lote-dt-pos').value || null;
  const fimDt = document.getElementById('modal-lote-dt-fim').value ||
    (['liberado','vazio'].includes(statusLoteSelecionado) ? new Date().toISOString().slice(0,16) : null);

  let count = 0;
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (vagoesSelecionados.has(v.id)) {
        v.status = statusLoteSelecionado;
        if (posDt) v.posDt = posDt;
        if (fimDt) v.fimDt = fimDt;
        count++;
      }
    });
    if (statusLoteSelecionado === 'devolvido') {
      comp.vagoes = comp.vagoes.filter(v => !vagoesSelecionados.has(v.id));
    }
  });
  composicoesAtivas = composicoesAtivas.filter(c => c.vagoes.length > 0);

  fecharModalLote();
  modoSelecaoMultipla = false;
  vagoesSelecionados.clear();
  const btn = document.getElementById('btn-selecao-multipla');
  btn.textContent = '☑ Selecionar Vários';
  btn.classList.remove('btn-ativo');
  atualizarBarraLote();
  salvarDados();
  alert(`Status de ${count} vagão(ões) atualizado para "${statusLabel(statusLoteSelecionado)}".`);
}

function fecharModalLote() {
  document.getElementById('modal-lote-overlay').style.display = 'none';
  statusLoteSelecionado = null;
}

// ── FAROL ──
function renderFarol() {
  let ativos = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (STATUS_VISIVEIS.includes(v.status)) {
        ativos.push({ ...v, chegadaDt: comp.chegadaDt });
      }
    });
  });

  const agora = Date.now();
  const limiteEstadia = config.limite_estadia * 3600000;
  const limiteRisco   = (config.limite_estadia - 4) * 3600000;

  let maxTpvMs = 0, somaPosMs = 0, countPos = 0, somaEsperaMs = 0, countEspera = 0;
  let vagoes_estadia = [], vagoes_risco = [];

  ativos.forEach(v => {
    const chegadaMs = new Date(v.chegadaDt).getTime();
    const tpv = agora - chegadaMs;
    if (tpv > maxTpvMs) maxTpvMs = tpv;

    if (tpv >= limiteEstadia)      vagoes_estadia.push({ ...v, tpvMs: tpv });
    else if (tpv >= limiteRisco)   vagoes_risco.push({ ...v, tpvMs: tpv });

    if (v.posDt) { somaPosMs += (agora - new Date(v.posDt).getTime()); countPos++; }
    else         { somaEsperaMs += tpv; countEspera++; }
  });

  // Ordena do mais antigo para o mais novo
  vagoes_estadia.sort((a, b) => b.tpvMs - a.tpvMs);
  vagoes_risco.sort((a, b) => b.tpvMs - a.tpvMs);

  const backlog = ativos.length > 30 ? ativos.length - 30 : 0;

  document.getElementById('val-tpv').innerText    = maxTpvMs > 0 ? formatarMs(maxTpvMs) : '—';
  document.getElementById('val-pos').innerText    = countPos > 0 ? formatarMs(somaPosMs / countPos) : '—';
  document.getElementById('val-espera').innerText = countEspera > 0 ? formatarMs(somaEsperaMs / countEspera) : '—';
  document.getElementById('val-estadia').innerText = vagoes_estadia.length;
  document.getElementById('val-risco').innerText   = vagoes_risco.length;
  document.getElementById('val-backlog').innerText  = backlog;

  // Visual dinâmico
  const fe = document.getElementById('farol-estadia');
  const fr = document.getElementById('farol-risco');
  fe.classList.toggle('alerta-estadia', vagoes_estadia.length > 0);
  fr.classList.toggle('alerta-risco',   vagoes_risco.length > 0);

  // Cards clicáveis
  fe.classList.toggle('clicavel', vagoes_estadia.length > 0);
  fr.classList.toggle('clicavel', vagoes_risco.length > 0);

  fe.onclick = vagoes_estadia.length > 0
    ? () => abrirModalAlerta('estadia', vagoes_estadia) : null;
  fr.onclick = vagoes_risco.length > 0
    ? () => abrirModalAlerta('risco', vagoes_risco) : null;
}

function formatarMs(ms) {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
}

// ── MODAL DE ALERTA (Estadia / Risco) ──
function abrirModalAlerta(tipo, vagoes) {
  const isEstadia = tipo === 'estadia';
  const cor       = isEstadia ? '#dc2626' : '#b45309';
  const titulo    = isEstadia ? '⚠ Vagões em Estadia' : '⚠ Vagões em Risco';
  const sub       = isEstadia
    ? `${vagoes.length} vagão(ões) com mais de ${config.limite_estadia}h no pátio`
    : `${vagoes.length} vagão(ões) entre ${config.limite_estadia - 4}h e ${config.limite_estadia}h`;

  document.getElementById('alerta-modal-titulo').textContent = titulo;
  document.getElementById('alerta-modal-sub').textContent    = sub;
  document.getElementById('alerta-modal-header').style.background =
    isEstadia
      ? 'linear-gradient(90deg, rgba(180,20,20,0.88), rgba(220,38,38,0.82))'
      : 'linear-gradient(90deg, rgba(140,80,0,0.88), rgba(202,138,4,0.82))';

  document.getElementById('alerta-modal-info').textContent =
    `Clique em um vagão para abrir o painel de status. Listado do mais crítico ao menos crítico.`;

  const lista = document.getElementById('alerta-modal-lista');
  lista.innerHTML = vagoes.map(v => {
    const dotClass  = isEstadia ? 'estadia' : 'risco';
    const tempClass = isEstadia ? 'estadia' : 'risco';
    const chegada   = new Date(v.chegadaDt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="alerta-vagao-item" onclick="fecharModalAlerta(); setTimeout(()=>abrirModal('${v.id}'),120);">
        <div class="alerta-dot ${dotClass}"></div>
        <div>
          <div class="alerta-id">${v.id}</div>
          <div class="alerta-hint">Chegada: ${chegada} · ${statusLabel(v.status)}</div>
        </div>
        <span class="alerta-tempo ${tempClass}">${formatarMs(v.tpvMs)}</span>
      </div>`;
  }).join('');

  document.getElementById('alerta-modal').style.display = 'flex';
}

function fecharModalAlerta() {
  document.getElementById('alerta-modal').style.display = 'none';
}

// Fechar clicando fora
document.addEventListener('click', e => {
  const modal = document.getElementById('alerta-modal');
  if (e.target === modal) fecharModalAlerta();
});

// ── ABA LIBERAÇÃO ──
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
        html += `
          <label class="liberacao-item">
            <input type="checkbox" class="check-liberacao" value="${v.id}">
            <span class="lib-id">${v.id}</span>
            <span class="lib-status-badge">✓ Liberado</span>
          </label>`;
      }
    });
  });

  div.innerHTML = html || '<div class="vazio-msg">Mude o status de um vagão para "Liberado" no painel para que ele apareça aqui.</div>';
}

function getSelecionados() {
  return [...document.querySelectorAll('.check-liberacao:checked')].map(cb => cb.value);
}

function confirmarDevolucaoMRS() {
  const selecionados = getSelecionados();
  if (selecionados.length === 0) {
    alert('Selecione ao menos um vagão para confirmar a devolução.');
    return;
  }

  if (!confirm(`Confirmar devolução de ${selecionados.length} vagão(ões) à MRS? Esta ação os removerá do pátio.`)) return;

  composicoesAtivas.forEach(comp => {
    comp.vagoes = comp.vagoes.filter(v => !selecionados.includes(v.id));
  });
  composicoesAtivas = composicoesAtivas.filter(c => c.vagoes.length > 0);
  salvarDados();
  alert(`${selecionados.length} vagão(ões) devolvido(s) com sucesso.`);
}

function gerarFormularioImpressao() {
  const plts = document.getElementById('lib-plts').value || '______';
  let dataLib = document.getElementById('lib-data').value;
  if (dataLib) { const [a,m,d] = dataLib.split('-'); dataLib = `${d}/${m}/${a}`; }
  else dataLib = '___/___/______';

  const checkboxes = document.querySelectorAll('.check-liberacao:checked');
  if (checkboxes.length === 0) { alert('Selecione os vagões liberados para gerar o formulário.'); return; }

  let listaHtml = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; font-size:11pt;">';
  checkboxes.forEach((cb, i) => { listaHtml += `<div><strong>${i+1}:</strong> ${cb.value}</div>`; });
  listaHtml += '</div>';

  ['csn', 'mrs'].forEach(via => {
    document.getElementById(`imp-plts-${via}`).innerText = plts;
    document.getElementById(`imp-data-${via}`).innerText = dataLib;
    document.getElementById(`imp-lista-${via}`).innerHTML = listaHtml;
  });

  window.print();
}

// ── GESTÃO: USUÁRIOS ──
function configurarGestao() {
  document.getElementById('btn-salvar-cfg').addEventListener('click', () => {
    config.limite_estadia = parseInt(document.getElementById('cfg-limite').value) || 24;
    localStorage.setItem(STORAGE_CFG, JSON.stringify(config));
    alert('Configuração salva!');
    renderFarol();
  });

  document.getElementById('btn-show-add-user').addEventListener('click', () => {
    const panel = document.getElementById('add-user-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  });

  document.getElementById('btn-cancel-add-user').addEventListener('click', () => {
    document.getElementById('add-user-panel').style.display = 'none';
    limparFormUser();
  });

  document.getElementById('btn-add-user').addEventListener('click', () => {
    const nome  = document.getElementById('user-nome').value.trim();
    const login = document.getElementById('user-login').value.trim();
    const senha = document.getElementById('user-senha').value;
    const nivel = document.getElementById('user-nivel').value;

    if (!nome || !login || !senha) { alert('Preencha nome, login e senha.'); return; }
    if (usuarios.find(u => u.login === login)) { alert('Esse login já existe.'); return; }

    const novoId = usuarios.length > 0 ? Math.max(...usuarios.map(u => u.id)) + 1 : 1;
    usuarios.push({ id: novoId, nome, login, senha, nivel });
    salvarUsuarios();
    renderUsuarios();
    document.getElementById('add-user-panel').style.display = 'none';
    limparFormUser();
  });
}

function limparFormUser() {
  ['user-nome','user-login','user-senha'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('user-nivel').value = 'op';
}

function renderUsuarios() {
  const div = document.getElementById('user-list');
  if (!div) return;

  div.innerHTML = usuarios.map(u => {
    const inicial = u.nome.charAt(0).toUpperCase();
    const badge = { admin: 'priv-admin', op: 'priv-op', view: 'priv-view' }[u.nivel] || 'priv-view';
    const labelNivel = { admin: 'Admin', op: 'Operador', view: 'Visualizador' }[u.nivel] || u.nivel;
    const deleteBtn = u.id === 1 ? '' : `<button class="btn-delete" onclick="removerUsuario(${u.id})" title="Remover">🗑</button>`;
    return `
      <div class="user-item">
        <div class="user-avatar">${inicial}</div>
        <div class="user-info">
          <div class="user-name">${u.nome}</div>
          <div class="user-login">@${u.login}</div>
        </div>
        <span class="priv-badge ${badge}">${labelNivel}</span>
        ${deleteBtn}
      </div>`;
  }).join('');
}

function removerUsuario(id) {
  if (!confirm('Remover este usuário?')) return;
  usuarios = usuarios.filter(u => u.id !== id);
  salvarUsuarios();
  renderUsuarios();
}

window.onload = init;