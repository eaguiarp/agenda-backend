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

        if (data < hoje) {
            mostrarMensagem("Não é possível agendar em datas passadas.", "erro");
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

// CORREÇÃO: Função abraçando toda a lógica corretamente
async function criarAgendamento(data, hora, placa) {
    const agendamentos = await obterAgendamentos();

    const novoAgendamento = {
        id: Date.now().toString(), // Melhor usar string para IDs
        data,
        hora,
        placa,
        status: "agendado"
    };

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
// BACKEND (Comunicação com API via Fetch)
// ===============================

const API_URL = "https://agenda-backend-production-5b72.up.railway.app/agendamentos";

async function obterAgendamentos() {
    try {
        const resposta = await fetch(API_URL);
        if (!resposta.ok) throw new Error("Erro ao buscar dados");
        return await resposta.json();
    } catch (erro) {
        mostrarMensagem("Erro de conexão com o servidor.", "erro");
        console.error(erro);
        return []; // Retorna lista vazia para não quebrar a tela
    }
}
async function salvarAgendamento(agendamento) {
    try {
        // Atenção: A URL deve ser a do seu Railway
        const resposta = await fetch("https://agenda-backend-production-5b72.up.railway.app/agendamentos", {
            method: "POST",
            headers: {
                "Content-Type": "application/json" // Avisa que estamos mandando JSON
            },
            body: JSON.stringify({
                data: agendamento.data,
                hora: agendamento.hora,
                placa: agendamento.placa // Tem que bater com o req.body do server.js
            })
        });

        if (!resposta.ok) {
            throw new Error("Erro ao salvar no servidor");
        }

        const dadosSalvos = await resposta.json(); // Aqui volta o objeto com o ID!
        console.log("Salvo com sucesso! ID:", dadosSalvos.id);
        
        return true; // Retorna true para o código saber que deu certo

    } catch (erro) {
        console.error("Erro na requisição:", erro);
        mostrarMensagem("Erro ao conectar com o servidor.", "erro");
        return false;
    }
}

// CORREÇÃO: Função de exclusão adicionada
async function excluirAgendamento(id) {
    try {
        await fetch(`${API_URL}/${id}`, {
            method: "DELETE"
        });
        await renderizarLista();
        mostrarMensagem("Agendamento excluído.", "sucesso");
    } catch (erro) {
        mostrarMensagem("Erro ao excluir.", "erro");
    }
}

// ===============================
// HORÁRIOS (Lógica de Renderização)
// ===============================

async function renderizarOpcoesHorario() {
    if (!inputData.value) {
        inputHora.innerHTML = '<option value="">Selecione a data primeiro</option>';
        return;
    }

    inputHora.innerHTML = '<option value="">Selecione o horário</option>';

    const agendamentos = await obterAgendamentos();
    const dataSelecionada = inputData.value;
    
    const agora = new Date();
    const horaAtual = agora.getHours();
    const minutoAtual = agora.getMinutes();
    const minutosAgora = horaAtual * 60 + minutoAtual;

    let minutosAtuais = 0;
    const fimDoDia = 24 * 60;

    // CORREÇÃO: Chaves no lugar certo para o While e para o fechamento da função
    while (minutosAtuais < fimDoDia) {
        let h = Math.floor(minutosAtuais / 60);
        let m = minutosAtuais % 60;

        let horarioFormatado = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        let intervalo = 60;

        if (h >= 0 && h < 3) intervalo = 25;
        else if (h === 3) intervalo = 60;
        else if (h >= 4 && h < 11) intervalo = 40;
        else if (h >= 11 && h < 13) intervalo = 60;
        else if (h >= 13 && h < 16) intervalo = 40;
        else if (h >= 17 && h < 20) intervalo = 40;
        else if (h >= 20) intervalo = 30;

        // Bloqueio inventário
        if (h === 6 || h === 16) {
            minutosAtuais += 60;
            continue;
        }

        // Bloquear horários passados se for hoje
        if (dataSelecionada === hoje && minutosAtuais < minutosAgora) {
            minutosAtuais += intervalo;
            continue;
        }

        const jaOcupado = agendamentos.some(a =>
            a.data === dataSelecionada &&
            a.hora === horarioFormatado &&
            a.status !== "finalizado"
        );

        if (!jaOcupado) {
            const option = document.createElement("option");
            option.value = horarioFormatado;
            option.textContent = horarioFormatado;
            inputHora.appendChild(option);
        }

        minutosAtuais += intervalo;
    }
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

    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado para este filtro.</li>";
        return;
    }

    listaFiltrada.sort((a, b) => new Date(`${a.data} ${a.hora}`) - new Date(`${b.data} ${b.hora}`));

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento";
        li.textContent = `${item.data} - ${item.hora} - ${item.placa} [${item.status}] `;

        if (item.status === "finalizado") {
            li.style.opacity = "0.5";
            li.style.textDecoration = "line-through";
        }

        const btnFinalizar = document.createElement("button");
        btnFinalizar.textContent = "Finalizar";
        btnFinalizar.onclick = () => finalizarAgendamento(item.id);
        btnFinalizar.disabled = item.status === "finalizado";

        const btnExcluir = document.createElement("button");
        btnExcluir.textContent = "Excluir";
        btnExcluir.style.marginLeft = "5px";
        btnExcluir.onclick = () => {
            if(confirm("Deseja realmente excluir este agendamento?")) {
                excluirAgendamento(item.id);
            }
        };

        li.appendChild(btnFinalizar);
        li.appendChild(btnExcluir);
        lista.appendChild(li);
    });
}

// ===============================
// MENSAGEM (Feedback Visual)
// ===============================

function mostrarMensagem(texto, tipo) {
    const div = document.getElementById("mensagem");
    if (!div) return;

    div.textContent = texto;
    div.className = tipo === "erro" ? "mensagem-erro" : "mensagem-sucesso";
    div.style.display = "block";

    setTimeout(() => {
        div.style.display = "none";
    }, 3000);
}