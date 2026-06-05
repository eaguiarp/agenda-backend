const STORAGE_KEY = 'arara_vagoes_ativos_v2';
const STORAGE_CFG = 'arara_config_v2';

let composicoesAtivas = [];
let config = { limite_estadia: 24 };
let vagaoSelecionado = null;

function init() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) composicoesAtivas = JSON.parse(salvo);
  
  const cfgSalvo = localStorage.getItem(STORAGE_CFG);
  if (cfgSalvo) config = { ...config, ...JSON.parse(cfgSalvo) };

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLiberacao();
  
  document.getElementById('cfg-limite').value = config.limite_estadia;
  document.getElementById('btn-salvar-cfg').addEventListener('click', () => {
    config.limite_estadia = parseInt(document.getElementById('cfg-limite').value) || 24;
    localStorage.setItem(STORAGE_CFG, JSON.stringify(config));
    alert('Configuração salva!');
  });

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

function atualizarInterface() {
  atualizarRelogio();
  limparComposicoesVazias();
  renderPainelFIFO();
  renderFarol();
  renderLiberacao();
}

function limparComposicoesVazias() {
  composicoesAtivas = composicoesAtivas.filter(comp => {
    return comp.vagoes.some(v => v.status !== 'vazio');
  });
}

function atualizarRelogio() {
  const agora = new Date();
  document.getElementById('relogio').textContent =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function configurarAbas() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── LÓGICA DE REGISTRO ──
function configurarFormComposicao() {
  document.getElementById('btn-nova-comp').addEventListener('click', () => {
    const data = document.getElementById('comp-data').value;
    const hora = document.getElementById('comp-hora').value;
    const textoVagoes = document.getElementById('comp-vagoes').value;

    if (!data || !hora || !textoVagoes.trim()) {
      alert('Preencha data, hora e os IDs dos vagões.');
      return;
    }

    const idsArr = textoVagoes.split(/[\n,]+/).map(v => v.trim().toUpperCase()).filter(v => v.length > 0);
    
    const novaComp = {
      chegadaDt: `${data}T${hora}`,
      vagoes: idsArr.map(id => ({
        id,
        status: 'nao_posicionado',
        posDt: null,
        fimDt: null
      }))
    };

    composicoesAtivas.push(novaComp);
    salvarDados();
    
    document.getElementById('comp-vagoes').value = '';
    alert(`${idsArr.length} vagão(ões) inserido(s) no pátio.`);
  });
}

// ── PAINEL DE LED (FIFO ÚNICO) ──
function renderPainelFIFO() {
  const container = document.getElementById('painel-vagoes-fifo');
  const resumo = document.getElementById('patio-resumo');
  container.innerHTML = '';
  
  let vagoesFila = [];
  let resumosDict = {};

  // Extrai apenas os vagões que AINDA NÃO FORAM LIBERADOS (status != 'vazio')
  composicoesAtivas.forEach(comp => {
    const pendentes = comp.vagoes.filter(v => v.status !== 'vazio');
    if (pendentes.length > 0) {
      const chaveResumo = formatarDataResumo(comp.chegadaDt);
      resumosDict[chaveResumo] = (resumosDict[chaveResumo] || 0) + pendentes.length;
      pendentes.forEach(v => vagoesFila.push(v));
    }
  });

  if (vagoesFila.length === 0) {
    resumo.textContent = 'Pátio Atual: Limpo (Sem operações ativas)';
  } else {
    const stringResumo = Object.keys(resumosDict).map(k => `[${k} — ${resumosDict[k]} FLTs]`).join(' ');
    resumo.textContent = `Pátio Atual: ${stringResumo}`;
  }

  // Renderiza exatos 30 slots (Os primeiros entram, o resto fica oculto em backlog)
  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.className = 'vagao-slot-fifo';

    if (i < vagoesFila.length) {
      const v = vagoesFila[i];
      slot.innerHTML = `
        <div class="bolinha ${v.status}" title="${v.id}" style="cursor:pointer;"></div>
        <div class="vagao-id">${formatarId(v.id)}</div>
      `;
      slot.querySelector('.bolinha').addEventListener('click', () => abrirModal(v.id));
    } else {
      slot.innerHTML = `<div class="bolinha slot-vazio"></div><div class="vagao-id"></div>`;
    }
    container.appendChild(slot);
  }
}

function formatarDataResumo(dtString) {
  const dt = new Date(dtString);
  const dia = String(dt.getDate()).padStart(2, '0');
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dia}/${meses[dt.getMonth()]}`;
}

function formatarId(id) {
  if (id.length > 4) return id.substring(0, 3) + '\n' + id.substring(3);
  return id;
}

// ── MODAL DE ATUALIZAÇÃO DO VAGÃO ──
function configurarModal() {
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);
  document.getElementById('modal-status').addEventListener('change', (e) => {
    document.getElementById('grp-posicionamento').style.display = e.target.value !== 'nao_posicionado' ? 'block' : 'none';
    document.getElementById('grp-fim').style.display = e.target.value === 'vazio' ? 'block' : 'none';
  });

  document.getElementById('modal-salvar').addEventListener('click', () => {
    if (!vagaoSelecionado) return;
    
    for (const comp of composicoesAtivas) {
      const vagao = comp.vagoes.find(v => v.id === vagaoSelecionado);
      if (vagao) {
        vagao.status = document.getElementById('modal-status').value;
        vagao.posDt = document.getElementById('modal-dt-pos').value || null;
        if (vagao.status === 'vazio') {
          vagao.fimDt = document.getElementById('modal-dt-fim').value || new Date().toISOString().slice(0,16);
        } else {
          vagao.fimDt = null;
        }
        break;
      }
    }
    fecharModal();
    salvarDados();
  });
}

function abrirModal(id) {
  vagaoSelecionado = id;
  let vagaoEncontrado = null;
  for (const comp of composicoesAtivas) {
    const v = comp.vagoes.find(v => v.id === id);
    if (v) { vagaoEncontrado = v; break; }
  }
  if (!vagaoEncontrado) return;

  document.getElementById('modal-vagao-id').textContent = id;
  const selStatus = document.getElementById('modal-status');
  selStatus.value = vagaoEncontrado.status;
  
  document.getElementById('modal-dt-pos').value = vagaoEncontrado.posDt || '';
  document.getElementById('modal-dt-fim').value = vagaoEncontrado.fimDt || '';

  selStatus.dispatchEvent(new Event('change')); // Força exibir/esconder campos
  document.getElementById('vagao-modal').style.display = 'flex';
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado = null;
}

// ── LÓGICA DO FAROL (6 INDICADORES) ──
function renderFarol() {
  let ativos = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      if (v.status !== 'vazio') ativos.push({ ...v, chegadaDt: comp.chegadaDt });
    });
  });

  const agora = Date.now();
  const limiteEstadia = config.limite_estadia * 3600000;
  const limiteRisco = (config.limite_estadia - 4) * 3600000;

  let maxTpvMs = 0;
  let somaPosMs = 0; let countPos = 0;
  let somaEsperaMs = 0; let countEspera = 0;
  let estourados = 0;
  let risco = 0;

  ativos.forEach(v => {
    const chegadaMs = new Date(v.chegadaDt).getTime();
    const tpvVagao = agora - chegadaMs;
    
    if (tpvVagao > maxTpvMs) maxTpvMs = tpvVagao;
    if (tpvVagao >= limiteEstadia) estourados++;
    else if (tpvVagao >= limiteRisco) risco++;

    if (v.posDt) {
      somaPosMs += (agora - new Date(v.posDt).getTime());
      countPos++;
    } else {
      somaEsperaMs += tpvVagao;
      countEspera++;
    }
  });

  const backlog = ativos.length > 30 ? ativos.length - 30 : 0;

  document.getElementById('val-tpv').innerText = maxTpvMs > 0 ? formatarMs(maxTpvMs) : '—';
  document.getElementById('val-pos').innerText = countPos > 0 ? formatarMs(somaPosMs / countPos) : '—';
  document.getElementById('val-espera').innerText = countEspera > 0 ? formatarMs(somaEsperaMs / countEspera) : '—';
  document.getElementById('val-estadia').innerText = estourados;
  document.getElementById('val-risco').innerText = risco;
  document.getElementById('val-backlog').innerText = backlog;
}

function formatarMs(ms) {
  const totalMinutos = Math.floor(ms / 60000);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${String(h).padStart(2,'0')}h ${String(m).padStart(2,'0')}m`;
}

// ── ABA DE LIBERAÇÃO / IMPRESSÃO ──
function configurarLiberacao() {
  document.getElementById('btn-gerar-form').addEventListener('click', gerarFormularioImpressao);
}

function renderLiberacao() {
  const div = document.getElementById('lista-liberacao');
  let checkboxesHTML = '';
  
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => {
      // Exibe na lista de liberação apenas vagões que já estão configurados como "vazio" pelo operador
      if (v.status === 'vazio' && !v.impresso) {
        checkboxesHTML += `
          <label style="display:block; padding: 6px; border-bottom: 1px solid #eee;">
            <input type="checkbox" class="check-liberacao" value="${v.id}"> ${v.id} (Liberado)
          </label>`;
      }
    });
  });

  div.innerHTML = checkboxesHTML || '<div class="vazio-msg">Mude o status de um vagão para "Vazio" no painel para que ele apareça aqui.</div>';
}

function gerarFormularioImpressao() {
  const plts = document.getElementById('lib-plts').value || '______';
  let dataLib = document.getElementById('lib-data').value;
  if (dataLib) {
    const [a,m,d] = dataLib.split('-');
    dataLib = `${d}/${m}/${a}`;
  } else {
    dataLib = '______/______/______';
  }

  const checkboxes = document.querySelectorAll('.check-liberacao:checked');
  if (checkboxes.length === 0) {
    alert('Selecione os vagões vazios na lista para gerar a via.');
    return;
  }

  let listaHtml = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; font-size:11pt;">';
  checkboxes.forEach((cb, index) => {
    listaHtml += `<div><strong>${index + 1}:</strong> ${cb.value}</div>`;
    // Opcional: Marcar no JS que o vagão foi impresso para tirá-lo da lista futuramente
  });
  listaHtml += '</div>';

  ['csn', 'mrs'].forEach(via => {
    document.getElementById(`imp-plts-${via}`).innerText = plts;
    document.getElementById(`imp-data-${via}`).innerText = dataLib;
    document.getElementById(`imp-lista-${via}`).innerHTML = listaHtml;
  });

  window.print();
}

window.onload = init;