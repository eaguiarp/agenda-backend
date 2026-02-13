// ===============================
// ELEMENTOS DO DOM
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


// ===============================
// INICIALIZAÇÃO
// ===============================

document.addEventListener("DOMContentLoaded", () => {


    // Impede selecionar datas passadas
    if (inputData) {
        inputData.setAttribute("min", hoje);
    }

inputData?.addEventListener("change", () => {
    renderizarOpcoesHorario();
});


// Filtro por data
filtroData?.addEventListener("change", () => {
    renderizarLista();
});

// Busca por placa
inputBuscaPlaca?.addEventListener("input", () => {
    renderizarLista();
});

// Botão "Ver Tudo"
btnLimpar?.addEventListener("click", () => {
    filtroData.value = "";
    inputBuscaPlaca.value = "";
    renderizarLista();
});


renderizarLista();
    // Evento de submit
    form?.addEventListener("submit", (e) => {
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

        criarAgendamento(data, hora, placa);
        form.reset();
        renderizarOpcoesHorario();
    });

});


// ===============================
// REGRAS DE NEGÓCIO
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

function criarAgendamento(data, hora, placa) {
  const agendamentos = obterAgendamentos();

  const novoAgendamento = {
    id: Date.now(),
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

  agendamentos.push(novoAgendamento);
  salvarAgendamentos(agendamentos);
  renderizarLista();
  mostrarMensagem("Agendamento salvo com sucesso.", "sucesso");
}

function finalizarAgendamento(id) {
  const agendamentos = obterAgendamentos();
  const agendamento = agendamentos.find(a => a.id === id);
  if (!agendamento) return;

  agendamento.status = "finalizado";
  salvarAgendamentos(agendamentos);
  renderizarLista();
  mostrarMensagem("Agendamento finalizado.", "sucesso");
}

function excluirAgendamento(id) {
  const agendamentos = obterAgendamentos();
  const novaLista = agendamentos.filter(a => a.id !== id);
  salvarAgendamentos(novaLista);
  renderizarLista();
  mostrarMensagem("Agendamento excluído.", "sucesso");
}

// ===============================
// LOCAL STORAGE
// ===============================

function obterAgendamentos() {
  return JSON.parse(localStorage.getItem("agendamentos")) || [];
}

function salvarAgendamentos(lista) {
  localStorage.setItem("agendamentos", JSON.stringify(lista));
}

// ===============================
// HORÁRIOS
// ===============================

function renderizarOpcoesHorario() {

  if (!inputData.value) {
    inputHora.innerHTML = '<option value="">Selecione a data primeiro</option>';
    return;
  }

  inputHora.innerHTML = '<option value="">Selecione o horário</option>';

  const agendamentos = obterAgendamentos();
  const dataSelecionada = inputData.value;

  const agora = new Date();
const horaAtual = agora.getHours();
const minutoAtual = agora.getMinutes();
const minutosAgora = horaAtual * 60 + minutoAtual;


  let minutosAtuais = 0;
  const fimDoDia = 24 * 60;
while (minutosAtuais < fimDoDia) {

    let h = Math.floor(minutosAtuais / 60);
    let m = minutosAtuais % 60;

    let horarioFormatado =
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    // Definição do intervalo
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
}}

// ===============================
// LISTA E DASHBOARD
// ===============================
function renderizarLista() {
    lista.innerHTML = "";
    const agendamentos = obterAgendamentos();
    
    // Pegamos os VALORES para filtrar
    const valorFiltroData = filtroData?.value;
    const termoBusca = inputBuscaPlaca?.value?.toUpperCase();

    const listaFiltrada = agendamentos.filter(a => {
        // Se não tem filtro, o 'bate' é sempre verdadeiro
        const bateData = valorFiltroData ? a.data === valorFiltroData : true;
        const batePlaca = termoBusca ? a.placa.includes(termoBusca) : true;
        return bateData && batePlaca;
    });

    // atualizarContadores(listaFiltrada); atualizarContadores(listaFiltrada);   // atualizarContadores(listaFiltrada);


   


    // 🛡️ Feedback se a lista estiver vazia
    if (listaFiltrada.length === 0) {
        lista.innerHTML = "<li class='vazio'>Nenhum agendamento encontrado para este filtro.</li>";
        return;
    }

    listaFiltrada.sort((a, b) => new Date(`${a.data} ${a.hora}`) - new Date(`${b.data} ${b.hora}`));

    listaFiltrada.forEach(item => {
        const li = document.createElement("li");
        li.className = "item-agendamento"; // Classe para você estilizar no CSS
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
// MENSAGEM
// ===============================

function mostrarMensagem(texto, tipo) {
  const div = document.getElementById("mensagem");
  if (!div) return;

  div.textContent = texto;
  div.className = tipo === "erro"
    ? "mensagem-erro"
    : "mensagem-sucesso";

  div.style.display = "block";

  setTimeout(() => {
    div.style.display = "none";
  }, 3000);
}
