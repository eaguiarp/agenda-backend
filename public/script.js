// ===============================
// ELEMENTOS DO DOM E INICIALIZAÇÃO
// ===============================
const form = document.getElementById("form-agendamento");
const inputData = document.getElementById("data");
const inputHora = document.getElementById("hora");
const selectProduto = document.getElementById("produto");
const inputPlaca = document.getElementById("placa");

const filtroData = document.getElementById("filtro-data");
const inputBuscaPlaca = document.getElementById("busca-placa");
const btnLimpar = document.getElementById("btn-limpar");
const lista = document.getElementById("lista-agendamentos");

const hoje = new Date().toISOString().split("T")[0];
const API_URL = "https://agenda-backend-production-5b72.up.railway.app/agendamentos";

const STATUS_ENCERRADOS = ["finalizado", "cancelado", "reagendado_fila"];

document.addEventListener("DOMContentLoaded", () => {
    if (inputData) inputData.setAttribute("min", hoje);

inputHora.disabled = true;
inputHora.innerHTML = '<option value="">Selecione data e produto</option>';

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
        const data = inputData.value;
        const hora = inputHora.value;
        const produto = selectProduto.value;
        const placa = inputPlaca.value.trim().toUpperCase();

        if (!data || !hora || !produto || !placa) {
            mostrarMensagem("Preencha todos os campos.", "erro");
            return;
        }
       await criarAgendamento(data, hora, produto, placa);
    });
});

// ===============================
// REGRAS DE NEGÓCIO E FLUXO
// ===============================

async function criarAgendamento(data, hora, produto, placa) {
    const agendamentos = await obterAgendamentos();
    const novo = { data, hora, produto, placa };
    

    if (agendamentos.some(a => 
    a.data === data &&
    a.hora === hora &&
    !STATUS_ENCERRADOS.includes(a.status)
)) {
    mostrarMensagem("Já existe agendamento nesse horário.", "erro");
    return;
}

    if (agendamentos.some(a => 
    a.data === data &&
    a.placa === placa &&
    !STATUS_ENCERRADOS.includes(a.status)
)) {
    mostrarMensagem("Essa placa já está agendada nesse dia.", "erro");
    return;
}

if (await salvarAgendamento(novo)) {

    form.reset();

    inputHora.disabled = true;
    inputHora.innerHTML = '<option value="">Selecione data e produto</option>';

    await renderizarLista();

    mostrarMensagem("Agendamento salvo com sucesso.", "sucesso");
}
}


async function chamarVeiculo(id) {
    try {
        const resposta = await fetch(`${API_URL}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "chamando" })
        });
        if (resposta.ok) {
            renderizarLista();
            mostrarMensagem("Chamada enviada para a TV!", "sucesso");
        }
    } catch (erro) {
        mostrarMensagem("Erro ao chamar.", "erro");
    }
}

async function iniciarDescarregamento(id) {
    try {
        const resposta = await fetch(`${API_URL}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "descarregando" })
        });
        if (resposta.ok) {
            renderizarLista();
            mostrarMensagem("Veículo em processo de descarga!", "sucesso");
        }
    } catch (erro) {
        mostrarMensagem("Erro ao mudar status.", "erro");
    }
}

fetch("/bandnews-live")
  .then(res => res.json())
  .then(data => {
    if (data.videoId) {
      const iframe = document.getElementById("bandnews-player");
      iframe.src = `https://www.youtube.com/embed/${data.videoId}`;
    }
  });


// ===============================
// BACKEND (Comunicação API)
// ===============================

async function obterAgendamentos() {
    try {
        const resposta = await fetch(API_URL);
        return await resposta.json();
    } catch (erro) {
        console.error(erro);
        return [];
    }
}

async function salvarAgendamento(agendamento) {
    try {
        const resposta = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(agendamento)
        });
        return resposta.ok;
    } catch (erro) { return false; }
}

async function finalizarAgendamento(id) {
    try {
        const resposta = await fetch(`${API_URL}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "finalizado" })
        });
        if (resposta.ok) {
            renderizarLista();
            mostrarMensagem("Carga finalizada!", "sucesso");
        }
    } catch (erro) { mostrarMensagem("Erro ao finalizar.", "erro"); }
}

async function cancelarAgendamento(id) {
    try {
        const resposta = await fetch(`${API_URL}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "cancelado" })
        });

        if (resposta.ok) {
            renderizarLista();
            mostrarMensagem("Agendamento cancelado.", "sucesso");
        }

    } catch (erro) {
        mostrarMensagem("Erro ao cancelar.", "erro");
    }
}

async function marcarAusente(id) {
    try {
        const resposta = await fetch(`${API_URL}/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                status: "reagendado_fila",
                observacao: "Veículo ausente no horário previsto para atendimento."
            })
        });

        if (resposta.ok) {
            renderizarLista();
            mostrarMensagem("Veículo marcado como ausente.", "sucesso");
        }

    } catch (erro) {
        mostrarMensagem("Erro ao marcar como ausente.", "erro");
    }
}


// ===============================
// FUNÇÕES AUXILIARES DE PRODUTO
// ===============================

function ehCantagalo(nomeProduto) {
    const PRODUTOS_CTG = [
        "CPII-F-32-SC-V-MA",
        "CPII-E-32-SC-V",
        "CPII-F-32-SC-25-MA",
        "CPV-ARI-SC-40-V"
    ];

    return PRODUTOS_CTG.includes(nomeProduto);
}

async function renderizarOpcoesHorario() {

    if (!inputData.value || !selectProduto?.value) {
        inputHora.disabled = true;
        inputHora.innerHTML = '<option value="">Selecione data e produto</option>';
        return;
    }

    inputHora.disabled = false;
    inputHora.innerHTML = '<option value="">Selecione o horário</option>';

    const agendamentos = await obterAgendamentos();
    const dataSelecionada = inputData.value;
    const dataObj = new Date(dataSelecionada + 'T12:00:00');
    const diaSemana = dataObj.getDay(); // 0=Dom, 1=Seg...
    const souCantagalo = ehCantagalo(selectProduto.value);

    const hojeData = new Date().toISOString().split("T")[0];
    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

    let horarios = [];

    // ==============================
    // REGRAS POR DIA
    // ==============================

    function adicionarIntervalo(inicio, fim, intervaloMin) {
        for (let m = inicio; m <= fim; m += intervaloMin) {
            horarios.push(m);
        }
    }

    // DOMINGO (0) → 6h às 14h (30 min)
    if (diaSemana === 0) {
        adicionarIntervalo(6 * 60, 14 * 60, 30);
    }

    // SABADO (6) → 7h às 16h (30 min)
    if (diaSemana === 6) {
        adicionarIntervalo(7 * 60, 15 * 60, 30);
    }

    // SEGUNDA (1) → começa 7h (30 min)
    else if (diaSemana === 1) {
        adicionarIntervalo(7 * 60, 23 * 60 + 30, 30);
    }

    // TERÇA A SEXTA (2 a 5) → 24h
    else if (diaSemana >= 2 && diaSemana <= 5) {

        // madrugada até 23:30
        adicionarIntervalo(0, 23 * 60 + 30, 30);

        // remover inventário 6h-7h
        horarios = horarios.filter(m => !(m >= 6*60 && m < 7*60));

        // remover inventário 16h-17h
        horarios = horarios.filter(m => !(m >= 16*60 && m < 17*60));
    }

    // SÁBADO (6) → até 16h
    else if (diaSemana === 6) {
        adicionarIntervalo(0, 16 * 60, 30);
    }
// ==============================
// EXCLUSIVIDADE CANTAGALO
// ==============================

const HORARIOS_EXCLUSIVOS = [
    2*60 + 40,   // 02:40
    7*60 + 30,   // 07:30
    9*60 + 40,   // 09:40
    13*60,       // 13:00
    15*60,       // 15:00
    17*60 + 40,  // 17:40
    21*60        // 21:00
];

if (diaSemana >= 1 && diaSemana <= 5) { // só dias úteis

    if (souCantagalo) {
        // Cantagalo vê SOMENTE exclusivos
        horarios = HORARIOS_EXCLUSIVOS;
    } else {
        // Outros não podem usar exclusivos
        horarios = horarios.filter(h => !HORARIOS_EXCLUSIVOS.includes(h));
    }
}


    // ==============================
    // FILTRAR OCUPADOS E PASSADO
    // ==============================

    horarios.forEach(m => {

        const hr = String(Math.floor(m / 60)).padStart(2, '0');
        const min = String(m % 60).padStart(2, '0');
        const horarioFormatado = `${hr}:${min}`;

        const ocupado = agendamentos.some(a =>
        a.data === dataSelecionada &&
        a.hora === horarioFormatado &&
        !STATUS_ENCERRADOS.includes(a.status)
);

        const passado = (dataSelecionada === hojeData && m < minutosAgora);

        if (!ocupado && !passado) {
            const option = document.createElement("option");
            option.value = horarioFormatado;
            option.textContent = horarioFormatado;
            inputHora.appendChild(option);
        }
    });
}

// ===============================
// LISTA E DASHBOARD
// ===============================

async function renderizarLista() {
    lista.innerHTML = "";
    const agendamentos = await obterAgendamentos();
    
    const valorFiltroData = filtroData?.value;
    const termoBusca = inputBuscaPlaca?.value?.toUpperCase();

    const listaFiltrada = agendamentos.filter(a => {
        const bateData = valorFiltroData ? a.data === valorFiltroData : true;
        const batePlaca = termoBusca ? (a.placa || "").includes(termoBusca) : true;
        return bateData && batePlaca;
    });

    // Atualiza contadores
    const countTotal = document.getElementById("count-total");
    const countPendente = document.getElementById("count-pendente");
    if (countTotal) {countTotal.textContent = agendamentos.filter(a => a.data === hoje).length;}
    
    if(countPendente) countPendente.textContent = listaFiltrada.filter(a => 
        ["agendado", "chamando", "descarregando"].includes(a.status)).length;

    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado.</li>";
        return;
    }

    // Ordenação Inteligente
    const ordemStatus = { 
    "chamando": 1, 
    "descarregando": 2, 
    "agendado": 3, 
    "reagendado_fila": 4,
    "finalizado": 5, 
    "cancelado": 6 
};
    listaFiltrada.sort((a, b) => {
        const pesoA = ordemStatus[a.status] || 99;
        const pesoB = ordemStatus[b.status] || 99;
        if (pesoA !== pesoB) return pesoA - pesoB;
        return new Date(`${a.data} ${a.hora}`) - new Date(`${b.data} ${b.hora}`);
    });

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento";
        
        // Cores visuais
        if (item.status === "finalizado") {li.style.opacity = "0.6"; li.style.borderLeft = "5px solid #2ecc71";}
        if (item.status === "chamando") li.style.borderLeft = "5px solid #f1c40f"; 
        if (item.status === "descarregando") li.style.borderLeft = "5px solid #e67e22"; 
        if (item.status === "reagendado_fila") { li.style.opacity = "0.8"; li.style.borderLeft = "5px solid #3498db";}
        if (item.status === "cancelado") {li.style.opacity = "0.4"; li.style.borderLeft = "5px solid #95a5a6";      }

        // === LÓGICA FLEXÍVEL DE PRODUTO ===
       
       const PRODUTOS_MAP = [
    { match: ["CPIII-32-RS-SC-V", "UPV/ARARÁ/URIO"], label: "CPIII" },
    { match: ["CPII-F-32-SC-V-MA", "FMA"], label: "MAUA" },
    { match: ["CPII-E-32-SC-V", "E32"], label: "E32" },
    { match: ["CPII-F-32-SC-25-MA", "M25"], label: "M25KG" },
    { match: ["CPV-ARI-SC-40-V"], label: "CPV" },
    { match: ["CANTAGALO"], label: "CANTAGALO" }
];

let produtoSimples = "GERAL";
const prod = (item.produto || "").toUpperCase();

// Loop para encontrar correspondência
for (const p of PRODUTOS_MAP) {
    if (p.match.some(m => prod.includes(m))) {
        produtoSimples = p.label;
        break; // sai do loop na primeira correspondência
    }
}
        // === EXIBIÇÃO VISUAL ===
        li.innerHTML = `
            <div style="line-height: 1.6;">
                <span style="font-size: 1.1rem;">${item.hora} - <strong>${item.placa}</strong></span>
                <br>
                <span style="color: #d35400; font-weight: bold; font-size: 0.85rem;">${produtoSimples}</span> 
                <small style="color: #999; margin-left: 5px;">(${item.status.toUpperCase()})</small>
            </div>
            
            <div class="acoes">
                ${item.status === 'agendado' ? 
                    `<button class="btn-cha" onclick="chamarVeiculo('${item.id}')">CHAMAR</button>` : ''}
                
                ${item.status === 'chamando' ? 
                    `<button class="btn-carr" onclick="iniciarDescarregamento('${item.id}')">DESCARREGANDO</button>` : ''}
                
                ${['chamando', 'descarregando'].includes(item.status) ? 
                    `<button class="btn-fin" onclick="finalizarAgendamento('${item.id}')">FINALIZAR</button>` : ''}
                
                ${item.status === 'agendado' ? `<button class="btn-aus" onclick="if(confirm('Mover para o final da fila?')) marcarAusente('${item.id}')">AUSENTE</button>` : ''}

                ${!['finalizado','cancelado'].includes(item.status) ? `<button class="btn-exc" onclick="if(confirm('Cancelar agendamento?')) cancelarAgendamento('${item.id}')">CANCELAR</button>` : ''}
        `;
        lista.appendChild(li);
    });
}
