// ===============================
// ELEMENTOS DO DOM E INICIALIZAÇÃO
// ===============================
const form = document.getElementById("form-agendamento");
const inputData = document.getElementById("data");
const inputHora = document.getElementById("hora");
const inputPlaca = document.getElementById("placa");

const filtroData = document.getElementById("filtro-data");
const inputBuscaPlaca = document.getElementById("busca-placa");
const btnLimpar = document.getElementById("btn-limpar");
const lista = document.getElementById("lista-agendamentos");

const hoje = new Date().toISOString().split("T")[0];
const API_URL = "https://agenda-backend-production-5b72.up.railway.app/agendamentos";

document.addEventListener("DOMContentLoaded", () => {
    if (inputData) {
        inputData.setAttribute("min", hoje);
    }

    inputData?.addEventListener("change", renderizarOpcoesHorario);
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
        const placa = inputPlaca.value.trim().toUpperCase();

        if (!data || !hora || !placa) {
            mostrarMensagem("Preencha todos os campos.", "erro");
            return;
        }

        await criarAgendamento(data, hora, placa);
    });
});

// ===============================
// REGRAS DE NEGÓCIO E FLUXO
// ===============================

function existeConflitoHorario(novo, lista) {
    return lista.some(a =>
        a.data === novo.data &&
        a.hora === novo.hora &&
        a.status !== "finalizado"
    );
}

function existePlacaNoMesmoDia(novo, lista) {
    return lista.some(a =>
        a.data === novo.data &&
        a.placa === novo.placa &&
        a.status !== "finalizado"
    );
}

async function criarAgendamento(data, hora, placa) {
    const agendamentos = await obterAgendamentos();

    const novoAgendamento = { data, hora, placa };

    if (existeConflitoHorario(novoAgendamento, agendamentos)) {
        mostrarMensagem("Já existe agendamento nesse horário.", "erro");
        return;
    }

    if (existePlacaNoMesmoDia(novoAgendamento, agendamentos)) {
        mostrarMensagem("Essa placa já está agendada nesse dia.", "erro");
        return;
    }

    const sucesso = await salvarAgendamento(novoAgendamento);
    
    if (sucesso) {
        form.reset();
        await renderizarLista();
        await renderizarOpcoesHorario();
        mostrarMensagem("Agendamento salvo com sucesso.", "sucesso");
    }
}

// ===============================
// BACKEND (Comunicação API)
// ===============================

async function obterAgendamentos() {
    try {
        const resposta = await fetch(API_URL);
        if (!resposta.ok) throw new Error("Erro ao buscar dados");
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
    } catch (erro) {
        return false;
    }
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
    } catch (erro) {
        mostrarMensagem("Erro ao finalizar.", "erro");
    }
}

async function excluirAgendamento(id) {
    try {
        await fetch(`${API_URL}/${id}`, { method: "DELETE" });
        renderizarLista();
        mostrarMensagem("Agendamento excluído.", "sucesso");
    } catch (erro) {
        mostrarMensagem("Erro ao excluir.", "erro");
    }
}

// ===============================
// HORÁRIOS (Lógica Inteligente)
// ===============================
async function renderizarOpcoesHorario() {
    if (!inputData.value) {
        inputHora.innerHTML = '<option value="">Selecione a data primeiro</option>';
        return;
    }

    inputHora.innerHTML = '<option value="">Selecione o horário</option>';
    const agendamentos = await obterAgendamentos();
    const dataSelecionada = inputData.value;
    
    const dataObj = new Date(dataSelecionada + 'T12:00:00');
    const diaSemana = dataObj.getDay(); // 0 = Dom, 1 = Seg, 6 = Sáb

    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

    let horariosDisponiveis = [];

    // ==========================================
    // REGRAS PARA DOMINGO
    // ==========================================
    if (diaSemana === 0) {
        // Manhã: 06:00 até 11:50 (a cada 25 min) -> m <= 710
        for (let m = 360; m <= 710; m += 25) {
            horariosDisponiveis.push(m);
        }
        // Tarde: 13:10 até 14:00 (a cada 25 min) -> m <= 840
        // Isso vai gerar: 13:10, 13:35 e 14:00.
        for (let m = 790; m <= 840; m += 25) {
            horariosDisponiveis.push(m);
        }
    }
    // ==========================================
    // REGRAS PARA OS DEMAIS DIAS
    // ==========================================
    else {
        let mAtuais = 0;
        
        // TRAVA SEGUNDA: Começa apenas às 07:00
        if (diaSemana === 1) mAtuais = 420; 

        while (mAtuais < 1440) {
            let h = Math.floor(mAtuais / 60);
            
            // TRAVA SÁBADO: Encerra às 16:00 (960 minutos)
            if (diaSemana === 6 && mAtuais > 960) break;

            let intervalo = 60;

            if (h >= 0 && h < 3) intervalo = 25;
            else if (h === 3) { if (mAtuais < 210) mAtuais = 210; intervalo = 90; }
            else if (h >= 4 && h < 6) intervalo = 40;
            else if (h === 6) { mAtuais = 420; continue; } // Inventário 06h-07h
            else if (h >= 7 && h < 11) intervalo = 40;
            else if (h >= 11 && h < 13) intervalo = 60;
            else if (h >= 13 && h < 16) intervalo = 40;
            else if (h === 16) { mAtuais = 1020; continue; } // Inventário 16h-17h
            else if (h >= 17 && h < 19) intervalo = 40;
            else if (h === 19) { mAtuais = 1200; continue; } // Ajuste 19h-20h
            else if (h >= 20) intervalo = 30;

            if (mAtuais < 1440) horariosDisponiveis.push(mAtuais);
            mAtuais += intervalo;
        }
    }

    // Renderização com filtro de ocupados/passados
    horariosDisponiveis.forEach(m => {
        let hr = Math.floor(m / 60).toString().padStart(2, '0');
        let min = (m % 60).toString().padStart(2, '0');
        let horarioFormatado = `${hr}:${min}`;

        const ocupado = agendamentos.some(a => a.data === dataSelecionada && a.hora === horarioFormatado && a.status !== "finalizado");
        const passado = (dataSelecionada === hoje && m < minutosAgora);

        if (!ocupado && !passado) {
            const option = document.createElement("option");
            option.value = horarioFormatado;
            option.textContent = horarioFormatado;
            inputHora.appendChild(option);
        }
    });
}
    // ==========================================
    // RENDERIZAR NO SELECT (Limpando Ocupados)
    // ==========================================
    horariosDisponiveis.forEach(m => {
        let hr = Math.floor(m / 60).toString().padStart(2, '0');
        let min = (m % 60).toString().padStart(2, '0');
        let horarioFormatado = `${hr}:${min}`;

        const ocupado = agendamentos.some(a => 
            a.data === dataSelecionada && 
            a.hora === horarioFormatado && 
            a.status !== "finalizado"
        );
        
        const passado = (dataSelecionada === hoje && m < minutosAgora);

        if (!ocupado && !passado) {
            const option = document.createElement("option");
            option.value = horarioFormatado;
            option.textContent = horarioFormatado;
            inputHora.appendChild(option);
        }
    });

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

    // Atualiza contadores do dashboard
    const countTotal = document.getElementById("count-total");
    const countPendente = document.getElementById("count-pendente");
    if(countTotal) countTotal.textContent = listaFiltrada.filter(a => a.data === hoje).length;
    if(countPendente) countPendente.textContent = listaFiltrada.filter(a => a.status === "agendado").length;

    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado.</li>";
        return;
    }

    listaFiltrada.sort((a, b) => new Date(`${a.data} ${a.hora}`) - new Date(`${b.data} ${b.hora}`));

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento";
        if (item.status === "finalizado") li.classList.add("finalizado");

        li.innerHTML = `
            <span>${item.data} - ${item.hora} - <strong>${item.placa}</strong></span>
            <div class="acoes">
                <button class="btn-fin" onclick="finalizarAgendamento('${item.id}')" ${item.status === "finalizado" ? 'disabled' : ''}>Finalizar</button>
                <button class="btn-exc" onclick="if(confirm('Excluir?')) excluirAgendamento('${item.id}')">Excluir</button>
            </div>
        `;
        lista.appendChild(li);
    });
}

function mostrarMensagem(texto, tipo) {
    const div = document.getElementById("mensagem");
    if (!div) return;
    div.textContent = texto;
    div.className = tipo === "erro" ? "mensagem-erro" : "mensagem-sucesso";
    div.style.display = "block";
    setTimeout(() => { div.style.display = "none"; }, 3000);
}