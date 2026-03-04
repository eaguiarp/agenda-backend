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
    } catch (e) {
        console.error("Erro ao carregar usuário", e);
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

    const naMesmaHora = agendamentos.filter(a =>
        a.data === data && a.hora === hora && !STATUS_ENCERRADOS.includes(a.status)
    );

    // Placa duplicada no dia
    if (agendamentos.some(a =>
        a.data === data && a.placa === placa && !STATUS_ENCERRADOS.includes(a.status)
    )) {
        mostrarMensagem("Essa placa já está agendada nesse dia.", "erro");
        return;
    }

    // Regra do Bitrem Grande — pátio livre de médios/grandes
    if (veiculoNovo.classe === "gigante") {
        const temOutroNaoPequeno = naMesmaHora.some(a =>
            classificarVeiculo(a.quantidade).classe !== "pequeno"
        );
        if (temOutroNaoPequeno) {
            mostrarMensagem("Bitrem Grande requer pátio livre de outros veículos médios/grandes.", "erro");
            return;
        }
        if (naMesmaHora.length >= 3) {
            mostrarMensagem("Limite de 3 veículos para operação com Bitrem Grande atingido.", "erro");
            return;
        }
    }

    // Regra do Toco — limite de 6 pequenos por hora
    if (veiculoNovo.classe === "pequeno") {
        const pequenos = naMesmaHora.filter(a =>
            classificarVeiculo(a.quantidade).classe === "pequeno"
        );
        if (pequenos.length >= 6) {
            mostrarMensagem("Limite de 6 veículos pequenos por hora atingido.", "erro");
            return;
        }
    }

    // Regra da capacidade total (máx 1820 sc por hora)
    const pesoSomado = naMesmaHora.reduce((acc, a) =>
        acc + classificarVeiculo(a.quantidade).peso, 0
    );
    if ((pesoSomado + veiculoNovo.peso) > 1820) {
        mostrarMensagem("Capacidade de descarga da hora atingida (Máx 1820 sc).", "erro");
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
// ===============================
async function renderizarOpcoesHorario() {
    if (!inputData.value || !selectProduto?.value) {
        inputHora.disabled = true;
        inputHora.innerHTML = '<option value="">Selecione data e produto</option>';
        return;
    }

    inputHora.disabled = false;
    inputHora.innerHTML = '<option value="">Carregando horários...</option>';

    const [agendamentos, bloqueios] = await Promise.all([
        obterAgendamentos(),
        obterBloqueios()
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

    let horarios = [];

    function adicionarIntervalo(inicio, fim, intervalo) {
        for (let m = inicio; m <= fim; m += intervalo) horarios.push(m);
    }

    if      (diaSemana === 0) { adicionarIntervalo(6 * 60, 14 * 60, 30); }
    else if (diaSemana === 6) { adicionarIntervalo(7 * 60, 15 * 60 + 30, 30); }
    else if (diaSemana === 1) { adicionarIntervalo(7 * 60, 23 * 60 + 30, 30); }
    else if (diaSemana >= 2 && diaSemana <= 5) {
        adicionarIntervalo(0, 23 * 60 + 30, 30);
        horarios = horarios.filter(m => !(m >= 6 * 60  && m < 7  * 60));
        horarios = horarios.filter(m => !(m >= 16 * 60 && m < 17 * 60));
    }

    const HORARIOS_EXCLUSIVOS = [
        2*60+40, 7*60+30, 9*60+40, 13*60, 15*60, 17*60+40, 21*60
    ];

    if (diaSemana >= 1 && diaSemana <= 5) {
        horarios = souCantagalo
            ? HORARIOS_EXCLUSIVOS
            : horarios.filter(h => !HORARIOS_EXCLUSIVOS.includes(h));
    }

    horarios.forEach(m => {
        const horarioFormatado = String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');

        const naMesmaHora = agendamentos.filter(a =>
            a.data === dataSelecionada &&
            a.hora === horarioFormatado &&
            !STATUS_ENCERRADOS.includes(a.status)
        );

        const passado   = (dataSelecionada === hojeData && m < minutosAgora);
        const bloqueado = horarioBloqueado(dataSelecionada, m, bloqueios);

        // Calcula capacidade restante para mostrar horários parcialmente ocupados
        const pesoOcupado = naMesmaHora.reduce((acc, a) =>
            acc + classificarVeiculo(a.quantidade).peso, 0
        );
        const cheio = pesoOcupado >= 1820;

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
        opt.textContent = "Nenhum horário disponível";
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

        if (item.status === "finalizado")     { li.style.opacity = "0.6"; li.style.borderLeft = "5px solid #2ecc71"; }
        if (item.status === "chamando")         li.style.borderLeft = "5px solid #f1c40f";
        if (item.status === "descarregando")    li.style.borderLeft = "5px solid #e67e22";
        if (item.status === "reagendado_fila") { li.style.opacity = "0.8"; li.style.borderLeft = "5px solid #3498db"; }
        if (item.status === "cancelado")       { li.style.opacity = "0.4"; li.style.borderLeft = "5px solid #95a5a6"; }

        const produtoSimples = resolverProduto(item.produto);
        const veiculo        = classificarVeiculo(item.quantidade);

        // Linha de extras
        const extras = [];
        if (item.motorista)   extras.push(item.motorista);
        if (item.quantidade)  extras.push(item.quantidade + ' sc · ' + veiculo.tipo);
        if (item.nota_fiscal) extras.push('NF ' + item.nota_fiscal);
        const extraHtml = extras.length
            ? `<small style="color:#aaa; display:block; margin-top:2px;">${extras.join(' &bull; ')}</small>`
            : '';

        li.innerHTML = `
            <div style="line-height:1.6; margin-bottom:8px;">
                <span style="font-size:1.1rem;">${item.hora} — <strong>${item.placa}</strong></span><br>
                <span style="color:#d35400; font-weight:bold; font-size:0.85rem;">${produtoSimples}</span>
                <small style="color:#999; margin-left:5px;">(${item.status.toUpperCase()})</small>
                ${item.alterado_por ? `<small style="color:#aaa; margin-left:4px;">— ${item.alterado_por}</small>` : ''}
                ${extraHtml}
            </div>
            <div class="acoes" style="display:flex; flex-wrap:wrap; gap:6px;">
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