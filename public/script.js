// ===============================
// ELEMENTOS DO DOM
// ===============================
const form            = document.getElementById("form-agendamento");
const inputData       = document.getElementById("data");
const inputHora       = document.getElementById("hora");
const selectProduto   = document.getElementById("produto");
const inputPlaca      = document.getElementById("placa");
const inputQuantidade = document.getElementById("quantidade");
const inputMotorista  = document.getElementById("motorista");
const inputNF         = document.getElementById("nota_fiscal");
const filtroData      = document.getElementById("filtro-data");
const inputBuscaPlaca = document.getElementById("busca-placa");
const btnLimpar       = document.getElementById("btn-limpar");
const lista           = document.getElementById("lista-agendamentos");

const d = new Date();
const hoje = d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');

const API_URL      = "https://agenda-backend-production-5b72.up.railway.app/agendamentos";
const BLOQUEIOS_URL= "https://agenda-backend-production-5b72.up.railway.app/bloqueios";
const STATUS_ENCERRADOS = ["finalizado", "cancelado", "reagendado_fila"];

// ===============================
// INICIALIZAÇÃO
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
    await carregarUsuario();

    if (inputData) inputData.setAttribute("min", hoje);
    if (inputHora) {
        inputHora.disabled = true;
        inputHora.innerHTML = '<option value="">Selecione data e produto</option>';
    }

    inputData?.addEventListener("change", renderizarOpcoesHorario);
    selectProduto?.addEventListener("change", renderizarOpcoesHorario);
    filtroData?.addEventListener("change", renderizarLista);
    inputBuscaPlaca?.addEventListener("input", renderizarLista);

    btnLimpar?.addEventListener("click", () => {
        filtroData.value = "";
        inputBuscaPlaca.value = "";
        renderizarLista();
    });

    renderizarLista();

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();

        const data      = inputData.value;
        const hora      = inputHora.value;
        const produto   = selectProduto.value;
        const placa     = inputPlaca.value.trim().toUpperCase();
        const quantidade= parseInt(inputQuantidade?.value) || 0;
        const motorista = inputMotorista?.value.trim() || "";
        const nf        = inputNF?.value.trim() || "";

        if (!data || !hora || !produto || !placa || !quantidade) {
            mostrarMensagem("Preencha todos os campos obrigatórios.", "erro");
            return;
        }
        await criarAgendamento(data, hora, produto, placa, quantidade, motorista, nf);
    });
});

// ===============================
// USUÁRIO LOGADO
// ===============================
let usuarioLogado = null;

async function carregarUsuario() {
    try {
        const res   = await fetch("/eu");
        const dados = await res.json();
        usuarioLogado = dados.usuario;
        const el = document.getElementById("header-usuario");
        if (el && dados.usuario) el.innerHTML = `👤 ${dados.usuario}`;
    } catch (e) {
        console.error("Erro ao carregar usuário", e);
    }
}

// ===============================
// NÚMERO DE FILA OPERACIONAL
// Sequencial diário: mesma data,
// ordenado por hora depois por id
// ===============================
function calcularNumeroFila(agendamento, todosAgendamentos) {
    const doDia = todosAgendamentos
        .filter(a => a.data === agendamento.data && a.status !== "cancelado")
        .sort((a, b) => {
            if (a.hora !== b.hora) return (a.hora || "").localeCompare(b.hora || "");
            return (a.id || 0) - (b.id || 0);
        });
    const pos = doDia.findIndex(a => a.id === agendamento.id);
    return pos >= 0 ? String(pos + 1).padStart(3, "0") : "---";
}

// ===============================
// FAROL OPERACIONAL
// Baseado no tempo de permanência
// dos veículos em operação
// ===============================
function atualizarFarol(agendamentos) {
    const marcador = document.getElementById("farol-marcador");
    const badge    = document.getElementById("farol-badge");
    const dot      = document.getElementById("farol-dot");
    const texto    = document.getElementById("farol-texto");
    const tempoel  = document.getElementById("farol-tempo");
    if (!marcador || !badge) return;

    const agora = new Date();

    // Veículos ativos com hora registrada
    const ativos = agendamentos.filter(a =>
        (a.status === "chamando" || a.status === "descarregando") && a.data && a.hora
    );

    let tempoMedioMin = 0;
    if (ativos.length > 0) {
        const tempos = ativos.map(a => {
            const inicio = new Date(a.data + "T" + a.hora + ":00");
            return Math.max(0, (agora - inicio) / 60000);
        });
        tempoMedioMin = tempos.reduce((s, t) => s + t, 0) / tempos.length;
    }

    // Determinar nível e posição do marcador
    let cls, cor, msg, posicao;

    if (tempoMedioMin <= 120) {
        cls = "farol-badge farol-verde";
        cor = "#16a34a";
        msg = "Operação normal";
        posicao = 5 + (tempoMedioMin / 120) * 28;
    } else if (tempoMedioMin <= 180) {
        cls = "farol-badge farol-amarelo";
        cor = "#ca8a04";
        msg = "Fluxo moderado — um pouco acima da média";
        posicao = 33 + ((tempoMedioMin - 120) / 60) * 17;
    } else if (tempoMedioMin <= 240) {
        cls = "farol-badge farol-laranja";
        cor = "#ea580c";
        msg = "Operação lenta";
        posicao = 50 + ((tempoMedioMin - 180) / 60) * 25;
    } else {
        cls = "farol-badge farol-vermelho";
        cor = "#dc2626";
        msg = "Excesso de veículos / Intempéries";
        posicao = Math.min(92, 75 + ((tempoMedioMin - 240) / 60) * 15);
    }

    marcador.style.left  = posicao + "%";
    badge.className      = cls;
    dot.style.background = cor;
    dot.className = (tempoMedioMin > 180) ? "farol-dot pulsando" : "farol-dot";
    texto.textContent    = msg;

    if (ativos.length > 0) {
        const h = Math.floor(tempoMedioMin / 60);
        const m = Math.round(tempoMedioMin % 60);
        tempoel.textContent = `Permanência média: ${h > 0 ? h + "h " : ""}${m}min (${ativos.length} em operação)`;
    } else {
        tempoel.textContent = "Nenhum veículo em operação no momento";
    }
}

// ===============================
// CLASSIFICAÇÃO DE VEÍCULO
// ===============================
function classificarVeiculo(q) {
    const n = parseInt(q) || 0;
    if (n <= 280) return { tipo: "Toco",            peso: 280, classe: "pequeno" };
    if (n <= 420) return { tipo: "Truck",            peso: 420, classe: "medio"  };
    if (n <= 560) return { tipo: "Carreta Simples",  peso: 560, classe: "medio"  };
    if (n <= 770) return { tipo: "Bitrem Simples",   peso: 770, classe: "medio"  };
    return           { tipo: "Bitrem Grande",    peso: 770, classe: "gigante" };
}

// ===============================
// BLOQUEIOS
// ===============================
async function obterBloqueios() {
    try {
        const res = await fetch(BLOQUEIOS_URL);
        return await res.json();
    } catch (e) {
        console.error("Erro ao carregar bloqueios", e);
        return [];
    }
}

function horarioBloqueado(dataStr, minutos, bloqueios) {
    const hr  = String(Math.floor(minutos / 60)).padStart(2, '0');
    const min = String(minutos % 60).padStart(2, '0');
    const horarioStr = hr + ':' + min;

    return bloqueios.some(b => {
        if (dataStr < b.data_inicio || dataStr > b.data_fim) return false;
        if (!b.hora_inicio || !b.hora_fim) return true;
        return horarioStr >= b.hora_inicio && horarioStr <= b.hora_fim;
    });
}

// ===============================
// REGRAS DE NEGÓCIO
// ===============================
async function criarAgendamento(data, hora, produto, placa, quantidade, motorista, nf) {
    const agendamentos  = await obterAgendamentos();
    const veiculoNovo   = classificarVeiculo(quantidade);

    // Agrupa por hora cheia (07:00 e 07:30 pertencem à mesma hora)
    const horaCheia = parseInt(hora.split(':')[0]);

    const naFaixa = agendamentos.filter(function(a) {
        if (a.data !== data) return false;
        if (STATUS_ENCERRADOS.includes(a.status)) return false;
        return parseInt(a.hora.split(':')[0]) === horaCheia;
    });

    // Placa duplicada no dia
    if (agendamentos.some(a =>
        a.data === data && a.placa === placa && !STATUS_ENCERRADOS.includes(a.status)
    )) {
        mostrarMensagem("Essa placa já está agendada nesse dia.", "erro");
        return;
    }

    // Regra do Bitrem Grande — pátio livre de médios/grandes na faixa
    if (veiculoNovo.classe === "gigante") {
        const temOutroNaoPequeno = naFaixa.some(a =>
            classificarVeiculo(a.quantidade).classe !== "pequeno"
        );
        if (temOutroNaoPequeno) {
            mostrarMensagem("Bitrem Grande requer pátio livre de outros veículos médios/grandes.", "erro");
            return;
        }
        if (naFaixa.length >= 3) {
            mostrarMensagem("Limite de 3 veículos para operação com Bitrem Grande atingido.", "erro");
            return;
        }
    }

    // Regra do Toco — limite de 6 pequenos na faixa
    if (veiculoNovo.classe === "pequeno") {
        const pequenos = naFaixa.filter(a =>
            classificarVeiculo(a.quantidade).classe === "pequeno"
        );
        if (pequenos.length >= 6) {
            mostrarMensagem("Limite de 6 veículos pequenos por hora atingido.", "erro");
            return;
        }
    }

    // Regra da capacidade total (máx 1820 sc na faixa de 1 hora)
    const pesoFaixa = naFaixa.reduce((acc, a) =>
        acc + classificarVeiculo(a.quantidade).peso, 0
    );
    if ((pesoFaixa + veiculoNovo.peso) > 1820) {
        mostrarMensagem("Capacidade de descarga da hora atingida (Máx 1820 sc).", "erro");
        return;
    }

    // Limite de segurança: máx 4 veículos na faixa
    if (naFaixa.length >= 4) {
        mostrarMensagem("Limite de veículos por hora atingido.", "erro");
        return;
    }

    const novo = {
        data, hora, produto, placa, quantidade,
        motorista:    motorista    || null,
        nota_fiscal:  nf           || null,
        status:       "agendado",
        alterado_por: usuarioLogado
    };

    if (await salvarAgendamento(novo)) {
        form.reset();
        if (inputHora) {
            inputHora.disabled = true;
            inputHora.innerHTML = '<option value="">Selecione data e produto</option>';
        }
        await renderizarLista();
        mostrarMensagem("Agendamento confirmado!", "sucesso");
    }
}

// ===============================
// AÇÕES DE STATUS
// ===============================
async function chamarVeiculo(id) {
    try {
        const r = await fetch(API_URL + '/' + id, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "chamando", alterado_por: usuarioLogado })
        });
        if (r.ok) { renderizarLista(); mostrarMensagem("Chamada enviada para a TV!", "sucesso"); }
    } catch (e) { mostrarMensagem("Erro ao chamar.", "erro"); }
}

async function iniciarDescarregamento(id) {
    try {
        const r = await fetch(API_URL + '/' + id, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "descarregando", alterado_por: usuarioLogado })
        });
        if (r.ok) { renderizarLista(); mostrarMensagem("Veículo em processo de descarga!", "sucesso"); }
    } catch (e) { mostrarMensagem("Erro ao mudar status.", "erro"); }
}

async function finalizarAgendamento(id) {
    try {
        const r = await fetch(API_URL + '/' + id, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "finalizado", alterado_por: usuarioLogado })
        });
        if (r.ok) { renderizarLista(); mostrarMensagem("Carga finalizada!", "sucesso"); }
    } catch (e) { mostrarMensagem("Erro ao finalizar.", "erro"); }
}

async function cancelarAgendamento(id) {
    try {
        const r = await fetch(API_URL + '/' + id, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "cancelado", alterado_por: usuarioLogado })
        });
        if (r.ok) { renderizarLista(); mostrarMensagem("Agendamento cancelado.", "sucesso"); }
    } catch (e) { mostrarMensagem("Erro ao cancelar.", "erro"); }
}

async function marcarAusente(id) {
    try {
        const r = await fetch(API_URL + '/' + id, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: "reagendado_fila",
                alterado_por: usuarioLogado,
                observacao: "Veículo ausente no horário previsto para atendimento."
            })
        });
        if (r.ok) { renderizarLista(); mostrarMensagem("Veículo marcado como ausente.", "sucesso"); }
    } catch (e) { mostrarMensagem("Erro ao marcar como ausente.", "erro"); }
}

// ===============================
// BACKEND
// ===============================
async function obterAgendamentos() {
    try {
        const r = await fetch(API_URL);
        return await r.json();
    } catch (e) { console.error(e); return []; }
}

async function salvarAgendamento(agendamento) {
    try {
        const r = await fetch(API_URL, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agendamento)
        });
        return r.ok;
    } catch (e) { return false; }
}

// ===============================
// PRODUTO
// ===============================
function ehCantagalo(nomeProduto) {
    return ["CPII-F-32-SC-V-MA","CPII-E-32-SC-V","CPII-F-32-SC-25-MA","CPV-ARI-SC-40-V"]
        .includes(nomeProduto);
}

const PRODUTOS_MAP = [
    { match: ["CPIII-32-RS-SC-V", "UPV/ARARÁ/URIO"], label: "CPIII"     },
    { match: ["CPII-F-32-SC-V-MA", "FMA"],            label: "MAUA"      },
    { match: ["CPII-E-32-SC-V", "E32"],               label: "E32"       },
    { match: ["CPII-F-32-SC-25-MA", "M25"],           label: "M25KG"     },
    { match: ["CPV-ARI-SC-40-V"],                      label: "CPV"       },
    { match: ["CANTAGALO"],                            label: "CANTAGALO" }
];

function resolverProduto(produtoRaw) {
    const prod = (produtoRaw || "").toUpperCase();
    for (var i = 0; i < PRODUTOS_MAP.length; i++) {
        if (PRODUTOS_MAP[i].match.some(m => prod.includes(m))) return PRODUTOS_MAP[i].label;
    }
    return "GERAL";
}

// ===============================
// RENDERIZAR HORÁRIOS
// Busca config do banco em vez de usar lógica fixa
// ===============================

let _configHorarios = null; // cache da sessão

async function obterConfigHorarios() {
    if (_configHorarios) return _configHorarios;
    try {
        const r = await fetch("https://agenda-backend-production-5b72.up.railway.app/horarios-config");
        _configHorarios = await r.json();
        return _configHorarios;
    } catch (e) {
        console.error("Erro ao buscar config de horários", e);
        return null;
    }
}

async function renderizarOpcoesHorario() {
    if (!inputData.value || !selectProduto?.value) {
        inputHora.disabled = true;
        inputHora.innerHTML = '<option value="">Selecione data e produto</option>';
        return;
    }

    inputHora.disabled = false;
    inputHora.innerHTML = '<option value="">Carregando horários...</option>';

    const [agendamentos, bloqueios, configDias] = await Promise.all([
        obterAgendamentos(),
        obterBloqueios(),
        obterConfigHorarios()
    ]);

    inputHora.innerHTML = '<option value="">Selecione o horário</option>';

    const dataSelecionada = inputData.value;
    const diaSemana       = new Date(dataSelecionada + 'T12:00:00').getDay();
    const souCantagalo    = ehCantagalo(selectProduto.value);

    const dl = new Date();
    const hojeData     = dl.getFullYear() + '-' +
        String(dl.getMonth() + 1).padStart(2, '0') + '-' +
        String(dl.getDate()).padStart(2, '0');
    const minutosAgora = new Date().getHours() * 60 + new Date().getMinutes();

    // Busca config do dia no banco
    const cfg = configDias ? configDias.find(c => c.dia_semana === diaSemana) : null;

    let horarios = [];

    if (cfg && cfg.ativo) {
        // Gera horários a partir da config do banco
        for (let m = cfg.inicio; m <= cfg.fim; m += 30) horarios.push(m);

        // Remove pausas configuradas
        const pausas = cfg.pausas || [];
        pausas.forEach(p => {
            horarios = horarios.filter(m => !(m >= p.inicio && m < p.fim));
        });

        // Horários exclusivos Cantagalo
        const exclusivosCantagalo = cfg.cantagalo || [];
        if (exclusivosCantagalo.length > 0 && (diaSemana >= 1 && diaSemana <= 5)) {
            horarios = souCantagalo
                ? exclusivosCantagalo
                : horarios.filter(h => !exclusivosCantagalo.includes(h));
        }
    } else if (!cfg) {
        // Fallback para lógica fixa caso API falhe
        function adicionarIntervalo(inicio, fim, intervalo) {
            for (let m = inicio; m <= fim; m += intervalo) horarios.push(m);
        }
        if      (diaSemana === 0) { adicionarIntervalo(6*60, 14*60, 30); }
        else if (diaSemana === 6) { adicionarIntervalo(0, 15*60+30, 30); horarios = horarios.filter(m => !(m >= 6*60 && m < 7*60)); }
        else if (diaSemana === 1) { adicionarIntervalo(7*60, 23*60+30, 30); }
        else if (diaSemana >= 2 && diaSemana <= 5) {
            adicionarIntervalo(0, 23*60+30, 30);
            horarios = horarios.filter(m => !(m >= 6*60 && m < 7*60));
            horarios = horarios.filter(m => !(m >= 16*60 && m < 17*60));
        }
    }
    // Se cfg existe mas ativo=false: horarios continua vazio (dia bloqueado)

    const capacidade   = cfg?.capacidade   || 1820;
    const maxVeiculos  = cfg?.max_veiculos || 4;

    horarios.forEach(m => {
        const horarioFormatado = String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
        const horaCheia = Math.floor(m / 60);

        const naHoraCheia = agendamentos.filter(a => {
            if (a.data !== dataSelecionada) return false;
            if (STATUS_ENCERRADOS.includes(a.status)) return false;
            return parseInt(a.hora.split(':')[0]) === horaCheia;
        });

        const passado   = (dataSelecionada === hojeData && m < minutosAgora);
        const bloqueado = horarioBloqueado(dataSelecionada, m, bloqueios);

        const pesoOcupado = naHoraCheia.reduce((acc, a) =>
            acc + classificarVeiculo(a.quantidade).peso, 0
        );
        const cheio = pesoOcupado >= capacidade || naHoraCheia.length >= maxVeiculos;

        if (!passado && !bloqueado && !cheio) {
            const option = document.createElement("option");
            option.value       = horarioFormatado;
            option.textContent = horarioFormatado;
            inputHora.appendChild(option);
        }
    });

    if (inputHora.options.length === 1) {
        const opt = document.createElement("option");
        opt.value = ""; opt.disabled = true;
        opt.textContent = cfg && !cfg.ativo ? "Dia sem operação" : "Nenhum horário disponível";
        inputHora.appendChild(opt);
    }
}

// ===============================
// LISTA E DASHBOARD
// ===============================
async function renderizarLista() {
    lista.innerHTML = "";
    const agendamentos    = await obterAgendamentos();
    const valorFiltroData = filtroData?.value;
    const termoBusca      = inputBuscaPlaca?.value?.toUpperCase();

    // Atualiza farol sempre que a lista é atualizada
    atualizarFarol(agendamentos);

    const listaFiltrada = agendamentos.filter(a => {
        const bateData  = valorFiltroData ? a.data === valorFiltroData : true;
        const batePlaca = termoBusca ? (a.placa || "").includes(termoBusca) : true;
        return bateData && batePlaca;
    });

    const countTotal    = document.getElementById("count-total");
    const countPendente = document.getElementById("count-pendente");
    if (countTotal)    countTotal.textContent    = agendamentos.filter(a => a.data === hoje).length;
    if (countPendente) countPendente.textContent = listaFiltrada.filter(a =>
        ["agendado","chamando","descarregando"].includes(a.status)).length;

    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado.</li>";
        return;
    }

    const ordemStatus = {
        "chamando":1,"descarregando":2,"agendado":3,
        "reagendado_fila":4,"finalizado":5,"cancelado":6
    };

    listaFiltrada.sort((a, b) => {
        const pesoA = ordemStatus[a.status] || 99;
        const pesoB = ordemStatus[b.status] || 99;
        if (pesoA !== pesoB) return pesoA - pesoB;
        return new Date(a.data + ' ' + a.hora) - new Date(b.data + ' ' + b.hora);
    });

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento";

        // Cores de borda por status
        if (item.status === "finalizado")     { li.style.opacity = "0.6"; li.style.borderLeftColor = "#2ecc71"; }
        if (item.status === "chamando")         li.style.borderLeftColor = "#f1c40f";
        if (item.status === "descarregando")    li.style.borderLeftColor = "#e67e22";
        if (item.status === "reagendado_fila") { li.style.opacity = "0.8"; li.style.borderLeftColor = "#3498db"; }
        if (item.status === "cancelado")       { li.style.opacity = "0.4"; li.style.borderLeftColor = "#95a5a6"; }

        const produtoSimples = resolverProduto(item.produto);
        const veiculo        = classificarVeiculo(item.quantidade);
        const numFila        = calcularNumeroFila(item, agendamentos);

        // Data formatada DD/MM/AAAA
        const dataFmt = item.data
            ? item.data.split("-").reverse().join("/")
            : "";

        // Linha de extras
        const extras = [];
        if (item.motorista)   extras.push(item.motorista);
        if (item.quantidade)  extras.push(item.quantidade + ' sc · ' + veiculo.tipo);
        if (item.nota_fiscal) extras.push('NF ' + item.nota_fiscal);
        const extraHtml = extras.length
            ? `<div class="item-extras">${extras.join(' &bull; ')}</div>`
            : '';

        li.innerHTML = `
            <div class="item-linha-topo">
                <div class="item-placa-hora">
                    ${dataFmt} às ${item.hora} — <strong>${item.placa}</strong>
                </div>
                <span class="item-fila-badge">Fila #${numFila}</span>
            </div>
            <div style="margin-bottom:6px;">
                <span class="item-produto">${produtoSimples}</span>
                <span class="item-status" style="margin-left:6px;">(${item.status.toUpperCase()})</span>
                ${item.alterado_por ? `<span class="item-status" style="margin-left:4px;">— ${item.alterado_por}</span>` : ''}
            </div>
            ${extraHtml}
            <div class="acoes">
                ${item.status === 'agendado' ?
                    `<button class="btn-cha" onclick="chamarVeiculo('${item.id}')">CHAMAR</button>` : ''}
                ${item.status === 'chamando' ?
                    `<button class="btn-carr" onclick="iniciarDescarregamento('${item.id}')">DESCARREGANDO</button>` : ''}
                ${['chamando','descarregando'].includes(item.status) ?
                    `<button class="btn-fin" onclick="finalizarAgendamento('${item.id}')">FINALIZAR</button>` : ''}
                ${item.status === 'agendado' ?
                    `<button class="btn-aus" onclick="if(confirm('Mover para o final da fila?')) marcarAusente('${item.id}')">AUSENTE</button>` : ''}
                ${!['finalizado','cancelado'].includes(item.status) ?
                    `<button class="btn-exc" onclick="if(confirm('Cancelar agendamento?')) cancelarAgendamento('${item.id}')">CANCELAR</button>` : ''}
            </div>`;

        lista.appendChild(li);
    });
}

// ===============================
// MENSAGEM
// ===============================
function mostrarMensagem(texto, tipo) {
    const el = document.getElementById("mensagem");
    if (!el) return;
    el.textContent   = texto;
    el.className     = tipo === "erro" ? "mensagem-erro" : "mensagem-sucesso";
    el.style.display = "block";
    setTimeout(function() { el.style.display = "none"; }, 4000);
}
