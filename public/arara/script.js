
// ── ESTADO GLOBAL ──────────────────────────────────────────────────
const STORAGE_KEY = 'arara_composicoes_ativas_v1';
const STORAGE_CFG = 'arara_config_v1';
const SENHA_PADRAO = '1234';

let composicoesAtivas = [];
let config = { limite_estadia: 24, senha: SENHA_PADRAO };
let vagaoSelecionado = null; // id do vagão em edição
let logado = false;

// ── INIT ───────────────────────────────────────────────────────────
function init() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) {
    composicoesAtivas = JSON.parse(salvo) || [];
  } else {
    const antigo = localStorage.getItem('arara_composicao_v1');
    if (antigo) {
      try {
        const comp = JSON.parse(antigo);
        if (comp && comp.chegadaDt && Array.isArray(comp.vagoes)) {
          composicoesAtivas = [{
            id: `COMP-LEGACY-${Date.now().toString().slice(-4)}`,
            chegadaDt: comp.chegadaDt,
            vagoes: comp.vagoes
          }];
          salvar();
          localStorage.removeItem('arara_composicao_v1');
        }
      } catch (err) {
        console.warn('Falha ao migrar dados legados:', err);
      }
    }
  }
  const cfgSalvo = localStorage.getItem(STORAGE_CFG);
  if (cfgSalvo) config = { ...config, ...JSON.parse(cfgSalvo) };

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLogin();
  configurarGestao();
  configurarLiberacao();
  atualizarComposicoesAtivas();
  atualizarEstadoRegistroComposicao();
  renderPainel();
  renderFarol();
  renderLiberacao();

  // Preenche data de hoje nos campos
  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('comp-data').value = hoje;
  document.getElementById('lib-data').value = hoje;

  // Relógio
  atualizarRelogio();
  setInterval(() => {
    atualizarRelogio();
    atualizarComposicoesAtivas();
    renderFarol();
  }, 1000);
}

function salvar() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(composicoesAtivas));
}
function salvarConfig() {
  localStorage.setItem(STORAGE_CFG, JSON.stringify(config));
}

function atualizarEstadoRegistroComposicao() {
  const btn = document.getElementById('btn-nova-comp');
  if (!btn) return;
  btn.disabled = composicoesAtivas.length >= 3;
}

function atualizarComposicoesAtivas() {
  const anterior = composicoesAtivas.length;
  composicoesAtivas = composicoesAtivas.filter(comp => {
    const temVagoes = Array.isArray(comp.vagoes) && comp.vagoes.length > 0;
    const restante = temVagoes && comp.vagoes.some(v => v.status !== 'vazio');
    return temVagoes && restante;
  });
  if (composicoesAtivas.length !== anterior) salvar();
  atualizarEstadoRegistroComposicao();
}

// ── RELÓGIO ────────────────────────────────────────────────────────
function atualizarRelogio() {
  const agora = new Date();
  document.getElementById('relogio').textContent =
    agora.toLocaleDateString('pt-BR') + ' ' +
    agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ── ABAS ───────────────────────────────────────────────────────────
function configurarAbas() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'gestao') renderGestao();
      if (btn.dataset.tab === 'liberacao') renderLiberacao();
    });
  });
}

// ── PAINEL DE VAGÕES ───────────────────────────────────────────────
function renderPainel() {
  const div = document.getElementById('painel-vagoes');
  if (composicoesAtivas.length === 0) {
    div.innerHTML = '<div class="vazio-msg">Nenhuma composição ativa. Registre uma acima.</div>';
    return;
  }

  div.innerHTML = '';
  composicoesAtivas.forEach(comp => {
    const totalVagoes = comp.vagoes.length;
    const restantes = comp.vagoes.filter(v => v.status !== 'vazio').length;
    const titulo = formatarDataFLTs(comp.chegadaDt, totalVagoes);
    const compSegment = document.createElement('div');
    compSegment.className = 'composicao-secao';
    compSegment.innerHTML = `
      <div class="composicao-titulo">
        <div>${titulo}</div>
        <div class="composicao-chegada">${restantes} FLT(s) ativos</div>
      </div>
      <div class="painel-vagoes"></div>
    `;

    const grid = compSegment.querySelector('.painel-vagoes');
    const slots = Array.from({ length: 30 }, (_, index) => comp.vagoes[index] || null);
    slots.forEach(v => {
      const isEmpty = !v;
      const slot = document.createElement('div');
      slot.className = 'vagao-slot' + (isEmpty ? ' vazio-indisponivel' : '');
      const statusClass = isEmpty ? 'slot-vazio' : v.status;
      const emEstadia = !isEmpty && calcularEstadia(v, comp.chegadaDt);
      slot.innerHTML = `
        <div class="bolinha ${statusClass}${emEstadia ? ' estadia' : ''}"></div>
        <div class="vagao-id">${isEmpty ? '' : formatarId(v.id)}</div>
      `;
      if (!isEmpty) slot.addEventListener('click', () => abrirModal(v.id));
      grid.appendChild(slot);
    });

    div.appendChild(compSegment);
  });
}

function formatarId(id) {
  if (id.length > 4) return id.substring(0, 3) + '\n' + id.substring(3);
  return id;
}

function formatarDataFLTs(chegadaDt, quantidade) {
  if (!chegadaDt) return `— — ${quantidade} FLTs`;
  const dt = new Date(chegadaDt);
  const dia = String(dt.getDate()).padStart(2, '0');
  const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
  return `${dia}/${meses[dt.getMonth()]} — ${quantidade} FLTs`;
}

function formatarDataHoraChegada(chegadaDt) {
  if (!chegadaDt) return '—';
  const dt = new Date(chegadaDt);
  return dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function calcularEstadia(vagao, chegadaDt) {
  if (!chegadaDt) return false;
  const limite = (config.limite_estadia || 24) * 3600000;
  const chegada = new Date(chegadaDt).getTime();
  return (Date.now() - chegada) > limite;
}

function encontrarVagao(id) {
  for (const comp of composicoesAtivas) {
    const vagao = comp.vagoes.find(v => v.id === id);
    if (vagao) return { comp, vagao };
  }
  return { comp: null, vagao: null };
}

// ── FAROL ──────────────────────────────────────────────────────────
function renderFarol() {
  const grid = document.getElementById('farol-grid');
  if (!grid) return;
  if (composicoesAtivas.length === 0) {
    grid.innerHTML = '<div class="farol-item"><div class="farol-label">Sem composição ativa</div><div class="farol-valor">—</div><div class="farol-sub">Registre até 3 composições</div></div>';
    return;
  }

  grid.innerHTML = '';
  const limiteMs = (config.limite_estadia || 24) * 3600000;

  composicoesAtivas.slice(0, 3).forEach(comp => {
    const restantes = comp.vagoes.filter(v => v.status !== 'vazio').length;
    const tpvChegLib = calcularTempoChegadaLiberacao(comp);
    const tpvPosLib = calcularTempoPosicionamentoLiberacao(comp);
    const item = document.createElement('div');
    item.className = 'farol-item ' + corFarol(tpvChegLib, limiteMs);
    item.innerHTML = `
      <div class="farol-label">${formatarDataFLTs(comp.chegadaDt, comp.vagoes.length)}</div>
      <div class="farol-valor">${formatarDuracao(tpvChegLib)}</div>
      <div class="farol-sub">Chegada → Liberação</div>
      <div class="farol-valor farol-valor-sm">${tpvPosLib !== null ? formatarDuracao(tpvPosLib) : '—'}</div>
      <div class="farol-sub">Posicionamento → Liberação</div>
      <div class="farol-sub">${restantes} vagão(s) restantes</div>
    `;
    grid.appendChild(item);
  });
}

function calcularTempoChegadaLiberacao(comp) {
  const chegada = new Date(comp.chegadaDt).getTime();
  const duracoes = comp.vagoes.map(v => {
    if (v.fimDt) return new Date(v.fimDt).getTime() - chegada;
    return Date.now() - chegada;
  });
  return Math.max(...duracoes, 0);
}

function calcularTempoPosicionamentoLiberacao(comp) {
  const duracoes = comp.vagoes.map(v => {
    if (!v.posDt) return null;
    const inicio = new Date(v.posDt).getTime();
    if (v.fimDt) return new Date(v.fimDt).getTime() - inicio;
    return Date.now() - inicio;
  }).filter(v => v !== null);
  if (duracoes.length === 0) return null;
  return Math.max(...duracoes, 0);
}

function corFarol(ms, limite) {
  const pct = ms / limite;
  if (pct < 0.5) return 'verde';
  if (pct < 0.8) return 'amarelo';
  return 'vermelho';
}

function formatarDuracao(ms) {
  if (ms < 0) ms = 0;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return `${h}h ${String(m).padStart(2,'0')}m`;
}

// ── FORM NOVA COMPOSIÇÃO ───────────────────────────────────────────
function configurarFormComposicao() {
  document.getElementById('btn-nova-comp').addEventListener('click', () => {
    const dataVal = document.getElementById('comp-data').value;
    const horaVal = document.getElementById('comp-hora').value;
    const vagoesRaw = document.getElementById('comp-vagoes').value.trim();

    if (!dataVal || !horaVal || !vagoesRaw) {
      alert('Preencha data, hora e pelo menos um vagão.');
      return;
    }

    if (composicoesAtivas.length >= 3) {
      alert('Já existem 3 composições ativas. Libere uma antes de registrar outra.');
      return;
    }

    const ids = vagoesRaw
      .split(/[\n,]+/)
      .map(s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);

    if (ids.length === 0) {
      alert('Nenhum ID de vagão válido encontrado.');
      return;
    }
    if (ids.length > 20) {
      alert('Máximo de 20 vagões por composição.');
      return;
    }

    const compId = `COMP-${dataVal.replace(/-/g, '')}-${horaVal.replace(/:/g, '')}-${Date.now().toString().slice(-4)}`;
    const novaComp = {
      id: compId,
      chegadaDt: `${dataVal}T${horaVal}`,
      vagoes: ids.map(id => ({ id, status: 'nao_posicionado', posDt: null, inicioDt: null, fimDt: null, nf: '', peso: '' }))
    };

    composicoesAtivas.push(novaComp);
    salvar();
    atualizarEstadoRegistroComposicao();
    renderPainel();
    renderFarol();
    renderLiberacao();
    document.getElementById('comp-vagoes').value = '';
    mostrarMsg(`Composição ${compId} registrada com ${ids.length} vagão(s).`, 'sucesso');
  });
}

// ── MODAL DO VAGÃO ─────────────────────────────────────────────────
function configurarModal() {
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);
  document.getElementById('vagao-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) fecharModal();
  });
  document.getElementById('modal-salvar').addEventListener('click', salvarVagao);
  document.getElementById('modal-remover').addEventListener('click', removerVagao);
  document.getElementById('modal-status').addEventListener('change', atualizarCamposModal);
}

function abrirModal(id) {
  const { comp, vagao } = encontrarVagao(id);
  if (!comp || !vagao) return;
  vagaoSelecionado = id;

  document.getElementById('modal-vagao-id').textContent = `${vagao.id} (${comp.id})`;
  document.getElementById('modal-status').value = vagao.status;
  document.getElementById('modal-dt-pos').value = vagao.posDt || '';
  document.getElementById('modal-dt-inicio').value = vagao.inicioDt || '';
  document.getElementById('modal-dt-fim').value = vagao.fimDt || '';
  document.getElementById('modal-nf').value = vagao.nf || '';
  document.getElementById('modal-peso').value = vagao.peso || '';

  atualizarCamposModal();
  document.getElementById('vagao-modal').style.display = 'flex';
}

function atualizarCamposModal() {
  const s = document.getElementById('modal-status').value;
  document.getElementById('grp-posicionamento').style.display = s !== 'nao_posicionado' ? 'block' : 'none';
  document.getElementById('grp-inicio').style.display = (s === 'vazio' || s === 'carregado') ? 'block' : 'none';
  document.getElementById('grp-fim').style.display = s === 'carregado' ? 'block' : 'none';
}

function fecharModal() {
  document.getElementById('vagao-modal').style.display = 'none';
  vagaoSelecionado = null;
}

function salvarVagao() {
  if (!vagaoSelecionado) return;
  const { comp, vagao } = encontrarVagao(vagaoSelecionado);
  if (!comp || !vagao) return;
  vagao.status = document.getElementById('modal-status').value;
  vagao.posDt = document.getElementById('modal-dt-pos').value || null;
  vagao.inicioDt = document.getElementById('modal-dt-inicio').value || null;
  vagao.fimDt = document.getElementById('modal-dt-fim').value || null;
  vagao.nf = document.getElementById('modal-nf').value;
  vagao.peso = document.getElementById('modal-peso').value;
  salvar();
  atualizarComposicoesAtivas();
  fecharModal();
  renderPainel();
  renderFarol();
  renderLiberacao();
  if (logado) renderGestao();
}

function removerVagao() {
  if (!vagaoSelecionado) return;
  const { comp } = encontrarVagao(vagaoSelecionado);
  if (!comp) return;
  if (!confirm('Remover vagão ' + vagaoSelecionado + '?')) return;
  comp.vagoes = comp.vagoes.filter(x => x.id !== vagaoSelecionado);
  atualizarComposicoesAtivas();
  salvar();
  fecharModal();
  renderPainel();
  renderFarol();
  renderLiberacao();
  if (logado) renderGestao();
}

// ── LIBERAÇÃO ─────────────────────────────────────────────────────
function configurarLiberacao() {
  document.getElementById('btn-gerar-form').addEventListener('click', gerarFormulario);
}

function renderLiberacao() {
  const div = document.getElementById('lista-liberacao');
  let vagoes = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => vagoes.push({ ...v, compId: comp.id }));
  });

  if (vagoes.length === 0) {
    div.innerHTML = '<div class="vazio-msg">Nenhum vagão na composição ativa.</div>';
    return;
  }
  div.innerHTML = '';
  vagoes.forEach(v => {
    const item = document.createElement('label');
    item.className = 'lib-item';
    item.innerHTML = `
      <input type="checkbox" class="lib-check" data-id="${v.id}">
      <span class="lib-item-id">${v.id}</span>
      <span class="lib-item-comp">${v.compId}</span>
      <span class="lib-item-status">${labelStatus(v.status)}</span>
    `;
    item.querySelector('.lib-check').addEventListener('change', (e) => {
      item.classList.toggle('selecionado', e.target.checked);
    });
    div.appendChild(item);
  });
}

function labelStatus(s) {
  const m = { vazio: 'Vazio', carregado: 'Carregado', nao_posicionado: 'Não posic.' };
  return m[s] || s;
}

function gerarFormulario() {
  const checks = document.querySelectorAll('.lib-check:checked');
  if (checks.length === 0) { alert('Selecione pelo menos um vagão.'); return; }

  const ids = Array.from(checks).map(c => c.dataset.id);
  const plts = document.getElementById('lib-plts').value || '—';
  const dataFmt = formatarDataExtenso(document.getElementById('lib-data').value);
  const placeholder = '_______';

  ['csn','mrs'].forEach(bloco => {
    document.getElementById(`imp-plts-${bloco}`).textContent = plts;
    document.getElementById(`imp-data-${bloco}`).textContent = dataFmt;
    document.getElementById(`imp-est-ini-${bloco}`).textContent = placeholder;
    document.getElementById(`imp-est-fim-${bloco}`).textContent = placeholder;
    document.getElementById(`imp-cons-${bloco}`).textContent = placeholder;
    document.getElementById(`imp-pos-${bloco}`).textContent = placeholder;

    const listaEl = document.getElementById(`imp-lista-${bloco}`);
    listaEl.innerHTML = '';
    ids.forEach((id, i) => {
      const d = document.createElement('div');
      d.textContent = (i + 1) + '. ' + id;
      listaEl.appendChild(d);
    });
  });

  window.print();
}

function formatarDataExtenso(str) {
  if (!str) return '___/___/______';
  const [y, m, d] = str.split('-');
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${d}/${meses[parseInt(m)-1]}/${y}`;
}

// ── LOGIN ──────────────────────────────────────────────────────────
function configurarLogin() {
  document.getElementById('btn-login').addEventListener('click', tentarLogin);
  document.getElementById('senha-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tentarLogin();
  });
}

function tentarLogin() {
  const s = document.getElementById('senha-input').value;
  if (s === config.senha) {
    logado = true;
    document.getElementById('bloco-login').style.display = 'none';
    document.getElementById('bloco-gestao').style.display = 'block';
    renderGestao();
  } else {
    document.getElementById('login-erro').style.display = 'block';
  }
}

// ── GESTÃO ─────────────────────────────────────────────────────────
function configurarGestao() {
  document.getElementById('btn-salvar-cfg').addEventListener('click', () => {
    const lim = parseInt(document.getElementById('cfg-limite').value);
    const novaSenha = document.getElementById('cfg-senha-nova').value.trim();
    if (!isNaN(lim) && lim > 0) config.limite_estadia = lim;
    if (novaSenha.length >= 3) config.senha = novaSenha;
    salvarConfig();
    renderFarol();
    alert('Configurações salvas.');
  });

  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
  document.getElementById('btn-imprimir-rel').addEventListener('click', () => window.print());
}

function renderGestao() {
  if (!logado) return;
  const wrap = document.getElementById('tabela-relatorio-wrap');
  const vagoes = [];
  composicoesAtivas.forEach(comp => {
    comp.vagoes.forEach(v => vagoes.push({ ...v, compId: comp.id, chegadaDt: comp.chegadaDt }));
  });

  if (vagoes.length === 0) {
    wrap.innerHTML = '<div class="vazio-msg">Sem dados para exibir.</div>';
    return;
  }

  const limiteMs = (config.limite_estadia || 24) * 3600000;

  let html = `<table class="tabela-rel">
    <thead><tr>
      <th>Composição</th><th>Vagão</th><th>Status</th><th>NF</th><th>Peso</th>
      <th>Posicionamento</th><th>Início C/D</th><th>Fim C/D</th>
      <th>Espera MRS</th><th>TPV</th><th>Estadia</th>
    </tr></thead><tbody>`;

  vagoes.forEach(v => {
    const chegada = new Date(v.chegadaDt);
    const posMs = v.posDt ? new Date(v.posDt) - chegada : null;
    const tpvMs = v.fimDt ? new Date(v.fimDt) - chegada : Date.now() - chegada.getTime();
    const emEstadia = tpvMs > limiteMs;

    html += `<tr>
      <td>${v.compId}</td>
      <td style="font-family:monospace;font-weight:700;">${v.id}</td>
      <td>${labelStatus(v.status)}</td>
      <td>${v.nf || '—'}</td>
      <td>${v.peso ? v.peso + 't' : '—'}</td>
      <td>${v.posDt ? new Date(v.posDt).toLocaleString('pt-BR') : '—'}</td>
      <td>${v.inicioDt ? new Date(v.inicioDt).toLocaleString('pt-BR') : '—'}</td>
      <td>${v.fimDt ? new Date(v.fimDt).toLocaleString('pt-BR') : '—'}</td>
      <td>${posMs !== null ? formatarDuracao(posMs) : '—'}</td>
      <td>${formatarDuracao(tpvMs)}</td>
      <td class="${emEstadia ? 'alerta' : ''}">${emEstadia ? '⚠ SIM' : 'Não'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
  document.getElementById('cfg-limite').value = config.limite_estadia;
}

// ── EXPORT CSV ────────────────────────────────────────────────────
function exportarCSV() {
  const linhaCabecalho = ['Composição','Vagão','Status','NF','Peso','Posicionamento','InicioCargaDesc','FimCargaDesc','EsperaMRS','TPV_horas','EmEstadia'];
  const linhas = [linhaCabecalho];

  composicoesAtivas.forEach(comp => {
    const chegada = new Date(comp.chegadaDt);
    const limiteMs = (config.limite_estadia || 24) * 3600000;
    comp.vagoes.forEach(v => {
      const posMs = v.posDt ? new Date(v.posDt) - chegada : '';
      const tpvMs = v.fimDt ? new Date(v.fimDt) - chegada : Date.now() - chegada.getTime();
      linhas.push([
        comp.id,
        v.id,
        v.status,
        v.nf || '',
        v.peso || '',
        v.posDt || '',
        v.inicioDt || '',
        v.fimDt || '',
        posMs !== '' ? (posMs / 3600000).toFixed(2) : '',
        (tpvMs / 3600000).toFixed(2),
        tpvMs > limiteMs ? 'SIM' : 'NAO'
      ]);
    });
  });

  const csv = linhas.map(r => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'relatorio_tpv_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

// ── MENSAGEM ──────────────────────────────────────────────────────
function mostrarMsg(txt, tipo) {
  // Simples alert por ora; pode ser substituído por toast
  console.log(`[${tipo}] ${txt}`);
}

// ── START ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);