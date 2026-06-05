
// ── ESTADO GLOBAL ──────────────────────────────────────────────────
const STORAGE_KEY = 'arara_composicao_v1';
const STORAGE_CFG = 'arara_config_v1';
const SENHA_PADRAO = '1234';

let composicao = null; // { chegadaDt, vagoes: [{id, status, posDt, inicioDt, fimDt, nf, peso}] }
let config = { limite_estadia: 24, senha: SENHA_PADRAO };
let vagaoSelecionado = null; // id do vagão em edição
let logado = false;

// ── INIT ───────────────────────────────────────────────────────────
function init() {
  const salvo = localStorage.getItem(STORAGE_KEY);
  if (salvo) composicao = JSON.parse(salvo);
  const cfgSalvo = localStorage.getItem(STORAGE_CFG);
  if (cfgSalvo) config = { ...config, ...JSON.parse(cfgSalvo) };

  configurarAbas();
  configurarModal();
  configurarFormComposicao();
  configurarLogin();
  configurarGestao();
  configurarLiberacao();
  renderPainel();
  renderFarol();
  renderLiberacao();

  // Preenche data de hoje nos campos
  const hoje = new Date().toISOString().split('T')[0];
  document.getElementById('comp-data').value = hoje;
  document.getElementById('lib-data').value = hoje;

  // Relógio
  atualizarRelogio();
  setInterval(atualizarRelogio, 1000);
  setInterval(renderFarol, 30000);
}

function salvar() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(composicao));
}
function salvarConfig() {
  localStorage.setItem(STORAGE_CFG, JSON.stringify(config));
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
  if (!composicao || composicao.vagoes.length === 0) {
    div.innerHTML = '<div class="vazio-msg">Nenhuma composição ativa. Registre uma acima.</div>';
    return;
  }
  div.innerHTML = '';
  composicao.vagoes.forEach(v => {
    const emEstadia = calcularEstadia(v);
    const slot = document.createElement('div');
    slot.className = 'vagao-slot' + (emEstadia ? ' em-estadia' : '');
    slot.innerHTML = `
      <div class="bolinha ${v.status}${emEstadia ? ' estadia' : ''}"></div>
      <div class="vagao-id">${formatarId(v.id)}</div>
    `;
    slot.addEventListener('click', () => abrirModal(v.id));
    div.appendChild(slot);
  });
}

function formatarId(id) {
  // Quebra em 2 linhas: tipo + número
  if (id.length > 4) return id.substring(0, 3) + '\n' + id.substring(3);
  return id;
}

function calcularEstadia(vagao) {
  if (!composicao) return false;
  const limite = (config.limite_estadia || 24) * 3600000;
  const chegada = new Date(composicao.chegadaDt).getTime();
  const agora = Date.now();
  return (agora - chegada) > limite;
}

// ── FAROL ──────────────────────────────────────────────────────────
function renderFarol() {
  if (!composicao || composicao.vagoes.length === 0) {
    ['tpv','pos','espera','estadia'].forEach(k => {
      document.getElementById('val-' + k).textContent = '—';
    });
    return;
  }

  const chegada = new Date(composicao.chegadaDt);
  const agora = new Date();
  const limiteMs = (config.limite_estadia || 24) * 3600000;

  // TPV total = agora - chegada (ou fim se todos liberados)
  const tpvMs = agora - chegada;
  document.getElementById('val-tpv').textContent = formatarDuracao(tpvMs);
  const farolTpv = document.getElementById('farol-tpv');
  farolTpv.className = 'farol-item ' + corFarol(tpvMs, limiteMs);

  // Vagões posicionados: pega o mais cedo
  const posicionados = composicao.vagoes.filter(v => v.posDt);
  if (posicionados.length > 0) {
    const primeiroPosMs = Math.min(...posicionados.map(v => new Date(v.posDt).getTime()));
    const esperaMs = primeiroPosMs - chegada.getTime();
    const posMs = agora.getTime() - primeiroPosMs;
    document.getElementById('val-espera').textContent = formatarDuracao(esperaMs);
    document.getElementById('val-pos').textContent = formatarDuracao(posMs);
    document.getElementById('farol-espera').className = 'farol-item ' + corFarol(esperaMs, 6 * 3600000);
    document.getElementById('farol-pos').className = 'farol-item ' + corFarol(posMs, limiteMs);
  } else {
    document.getElementById('val-espera').textContent = 'Aguardando';
    document.getElementById('val-pos').textContent = '—';
  }

  // Contagem estadia
  const emEstadia = composicao.vagoes.filter(v => calcularEstadia(v)).length;
  document.getElementById('val-estadia').textContent = emEstadia;
  const farolEst = document.getElementById('farol-estadia');
  farolEst.className = 'farol-item ' + (emEstadia > 0 ? 'vermelho' : 'verde');
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

    const ids = vagoesRaw
      .split(/[\n,]+/)
      .map(s => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);

    if (ids.length === 0) {
      alert('Nenhum ID de vagão válido encontrado.');
      return;
    }
    if (ids.length > 30) {
      alert('Máximo de 30 vagões por composição.');
      return;
    }

    if (composicao && composicao.vagoes.length > 0) {
      if (!confirm('Já existe uma composição ativa. Deseja substituir?')) return;
    }

    composicao = {
      chegadaDt: dataVal + 'T' + horaVal,
      vagoes: ids.map(id => ({ id, status: 'nao_posicionado', posDt: null, inicioDt: null, fimDt: null, nf: '', peso: '' }))
    };
    salvar();
    renderPainel();
    renderFarol();
    renderLiberacao();
    document.getElementById('comp-vagoes').value = '';
    mostrarMsg('Composição registrada com ' + ids.length + ' vagão(s).', 'sucesso');
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
  if (!composicao) return;
  vagaoSelecionado = id;
  const v = composicao.vagoes.find(x => x.id === id);
  if (!v) return;

  document.getElementById('modal-vagao-id').textContent = v.id;
  document.getElementById('modal-status').value = v.status;
  document.getElementById('modal-dt-pos').value = v.posDt || '';
  document.getElementById('modal-dt-inicio').value = v.inicioDt || '';
  document.getElementById('modal-dt-fim').value = v.fimDt || '';
  document.getElementById('modal-nf').value = v.nf || '';
  document.getElementById('modal-peso').value = v.peso || '';

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
  if (!vagaoSelecionado || !composicao) return;
  const v = composicao.vagoes.find(x => x.id === vagaoSelecionado);
  if (!v) return;
  v.status = document.getElementById('modal-status').value;
  v.posDt = document.getElementById('modal-dt-pos').value || null;
  v.inicioDt = document.getElementById('modal-dt-inicio').value || null;
  v.fimDt = document.getElementById('modal-dt-fim').value || null;
  v.nf = document.getElementById('modal-nf').value;
  v.peso = document.getElementById('modal-peso').value;
  salvar();
  fecharModal();
  renderPainel();
  renderFarol();
  renderLiberacao();
  if (logado) renderGestao();
}

function removerVagao() {
  if (!vagaoSelecionado || !composicao) return;
  if (!confirm('Remover vagão ' + vagaoSelecionado + '?')) return;
  composicao.vagoes = composicao.vagoes.filter(x => x.id !== vagaoSelecionado);
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
  if (!composicao || composicao.vagoes.length === 0) {
    div.innerHTML = '<div class="vazio-msg">Nenhum vagão na composição ativa.</div>';
    return;
  }
  div.innerHTML = '';
  composicao.vagoes.forEach(v => {
    const item = document.createElement('label');
    item.className = 'lib-item';
    item.innerHTML = `
      <input type="checkbox" class="lib-check" data-id="${v.id}">
      <span class="lib-item-id">${v.id}</span>
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
  const estIni = document.getElementById('lib-est-ini').value || '—';
  const estFim = document.getElementById('lib-est-fim').value || '—';
  const consHora = document.getElementById('lib-cons-hora').value || '—';
  const posHora = document.getElementById('lib-pos-hora').value || '—';

  // Preenche os dois blocos (CSN e MRS) igualmente
  ['csn','mrs'].forEach(bloco => {
    document.getElementById(`imp-plts-${bloco}`).textContent = plts;
    document.getElementById(`imp-data-${bloco}`).textContent = dataFmt;
    document.getElementById(`imp-est-ini-${bloco}`).textContent = estIni;
    document.getElementById(`imp-est-fim-${bloco}`).textContent = estFim;
    document.getElementById(`imp-cons-${bloco}`).textContent = consHora;
    document.getElementById(`imp-pos-${bloco}`).textContent = posHora;

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

  document.getElementById('btn-encerrar-comp').addEventListener('click', () => {
    if (!confirm('Encerrar composição atual? Os dados serão apagados.')) return;
    composicao = null;
    salvar();
    renderPainel();
    renderFarol();
    renderLiberacao();
    renderGestao();
    alert('Composição encerrada.');
  });

  document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
  document.getElementById('btn-imprimir-rel').addEventListener('click', () => window.print());
}

function renderGestao() {
  if (!logado) return;
  const wrap = document.getElementById('tabela-relatorio-wrap');
  if (!composicao || composicao.vagoes.length === 0) {
    wrap.innerHTML = '<div class="vazio-msg">Sem dados para exibir.</div>';
    return;
  }

  const chegada = new Date(composicao.chegadaDt);
  const limiteMs = (config.limite_estadia || 24) * 3600000;

  let html = `<table class="tabela-rel">
    <thead><tr>
      <th>Vagão</th><th>Status</th><th>NF</th><th>Peso</th>
      <th>Posicionamento</th><th>Início C/D</th><th>Fim C/D</th>
      <th>Espera MRS</th><th>TPV</th><th>Estadia</th>
    </tr></thead><tbody>`;

  composicao.vagoes.forEach(v => {
    const posMs = v.posDt ? new Date(v.posDt) - chegada : null;
    const tpvMs = v.fimDt ? new Date(v.fimDt) - chegada : Date.now() - chegada.getTime();
    const emEstadia = tpvMs > limiteMs;

    html += `<tr>
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
  if (!composicao) return;
  const linhas = [
    ['Vagão','Status','NF','Peso','Posicionamento','InicioCargaDesc','FimCargaDesc','EsperaMRS','TPV_horas','EmEstadia']
  ];
  const chegada = new Date(composicao.chegadaDt);
  const limiteMs = (config.limite_estadia || 24) * 3600000;

  composicao.vagoes.forEach(v => {
    const posMs = v.posDt ? new Date(v.posDt) - chegada : '';
    const tpvMs = v.fimDt ? new Date(v.fimDt) - chegada : Date.now() - chegada.getTime();
    linhas.push([
      v.id, v.status, v.nf || '', v.peso || '',
      v.posDt || '', v.inicioDt || '', v.fimDt || '',
      posMs !== '' ? (posMs / 3600000).toFixed(2) : '',
      (tpvMs / 3600000).toFixed(2),
      tpvMs > limiteMs ? 'SIM' : 'NAO'
    ]);
  });

const novaComp = {
    id: `COMP-${dataFormatoBR(data) || 'NOVA'}`, // Exemplo de ID gerado
    dataChegada: data,
    horaChegada: hora,
    vagoes: vagoesLista
};


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