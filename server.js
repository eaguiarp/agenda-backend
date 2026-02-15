require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// Configuração do banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Rota principal
app.get("/", (req, res) => {
  res.send("Servidor da Agenda funcionando 🚀");
});

// Listar agendamentos
app.get("/agendamentos", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM agendamentos ORDER BY data"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

// Criar agendamento
app.post("/agendamentos", async (req, res) => {
  try {
    const { empresa, data, horario, nome } = req.body;

    await pool.query(
      "INSERT INTO agendamentos (empresa, data, horario, nome) VALUES ($1, $2, $3, $4)",
      [empresa, data, horario, nome]
    );

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao criar agendamento" });
  }
});

// ARQUIVO: server.js (ou index.js) - No Backend

app.post("/agendamentos", async (req, res) => {
    try {
        // Recebe os dados que vieram do Frontend
        const { data, hora, placa } = req.body; 

        // AQUI entra o seu código do pool.query
        // Note que adicionei "RETURNING *" no final para pegar o ID gerado
        const novoAgendamento = await pool.query(
            "INSERT INTO agendamentos (data, hora, placa, status) VALUES ($1, $2, $3, $4) RETURNING *",
            [data, hora, placa, "agendado"]
        );

        // Devolve para o Frontend o agendamento criado (com o ID!)
        res.json(novoAgendamento.rows[0]); 

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro no servidor");
    }
});


// Atualizar status
app.put("/agendamentos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    await pool.query(
      "UPDATE agendamentos SET status = $1 WHERE id = $2",
      [status, id]
    );

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao atualizar agendamento" });
  }
});

// Deletar agendamento
app.delete("/agendamentos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      "DELETE FROM agendamentos WHERE id = $1",
      [id]
    );

    res.json({ sucesso: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao deletar agendamento" });
  }
});

// 🚀 Sempre por último
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});
