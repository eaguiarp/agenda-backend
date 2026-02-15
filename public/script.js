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
    if (inputData) inputData.setAttribute("min", hoje);

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

async function criarAgendamento(data, hora, placa) {
    const agendamentos = await obterAgendamentos();
    const novo = { data, hora, placa };

    if (agendamentos.some(a => a.data === data && a.hora === hora && a.status !== "finalizado")) {
        mostrarMensagem("Já existe agendamento nesse horário.", "erro");
        return;
    }

    if (agendamentos.some(a => a.data === data && a.placa === placa && a.status !== "finalizado")) {
        mostrarMensagem("Essa placa já está agendada nesse dia.", "erro");
        return;
    }

    if (await salvarAgendamento(novo)) {
        form.reset();
        await renderizarLista();
        await renderizarOpcoesHorario();
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

async function excluirAgendamento(id) {
    try {
        await fetch(`${API_URL}/${id}`, { method: "DELETE" });
        renderizarLista();
        mostrarMensagem("Agendamento excluído.", "sucesso");
    } catch (erro) { mostrarMensagem("Erro ao excluir.", "erro"); }
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
    const diaSemana = dataObj.getDay();

    const agora = new Date();
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();

    let horariosDisponiveis = [];

    if (diaSemana === 0) {
        for (let m = 360; m <= 710; m += 25) horariosDisponiveis.push(m);
        for (let m = 790; m <= 840; m += 25) horariosDisponiveis.push(m);
    } else {
        let mAtuais = (diaSemana === 1) ? 420 : 0; 
        while (mAtuais < 1440) {
            let h = Math.floor(mAtuais / 60);
            if (diaSemana === 6 && mAtuais > 960) break;
            let intervalo = 60;

            if (h >= 0 && h < 3) intervalo = 25;
            else if (h === 3) { if (mAtuais < 210) mAtuais = 210; intervalo = 90; }
            else if (h >= 4 && h < 6) intervalo = 40;
            else if (h === 6) { mAtuais = 420; continue; }
            else if (h >= 7 && h < 11) intervalo = 40;
            else if (h >= 11 && h < 13) intervalo = 60;
            else if (h >= 13 && h < 16) intervalo = 40;
            else if (h === 16) { mAtuais = 1020; continue; }
            else if (h >= 17 && h < 19) intervalo = 40;
            else if (h >= 20) intervalo = 30;
            else if (h === 19) { mAtuais = 1200; continue; }

            if (mAtuais < 1440) horariosDisponiveis.push(mAtuais);
            mAtuais += intervalo;
        }
    }

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

    const countTotal = document.getElementById("count-total");
    const countPendente = document.getElementById("count-pendente");
    if(countTotal) countTotal.textContent = listaFiltrada.filter(a => a.data === hoje).length;
if(countPendente) countPendente.textContent = listaFiltrada.filter(a => a.status === "agendado" || a.status === "chamando").length;

    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado.</li>";
        return;
    }

    listaFiltrada.sort((a, b) => new Date(`${a.data} ${a.hora}`) - new Date(`${b.data} ${b.hora}`));

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento";
        if (item.status === "finalizado") li.style.opacity = "0.5";
        if (item.status === "chamando") li.style.borderLeft = "5px solid #f1c40f";

        li.innerHTML = `
            <span>${item.data} - ${item.hora} - <strong>${item.placa}</strong> [${item.status}]</span>
            <div class="acoes">
                <button class="btn-cha" onclick="chamarVeiculo('${item.id}')" ${item.status === "finalizado" ? 'disabled' : ''}>CHAMAR</button>
                <button class="btn-fin" onclick="finalizarAgendamento('${item.id}')" ${item.status === "finalizado" ? 'disabled' : ''}>FINALIZAR</button>
                <button class="btn-exc" onclick="if(confirm('Excluir?')) excluirAgendamento('${item.id}')">EXCLUIR</button>
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