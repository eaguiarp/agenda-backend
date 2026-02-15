require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// Configuração do banco de dados (Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Rota principal (Teste de vida)
app.get("/", (req, res) => {
  res.send("Servidor da Agenda funcionando 🚀");
});

// ========================================================
// ROTA MÁGICA: Crie a tabela acessando /criar-banco
// ========================================================
app.get("/criar-banco", async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agendamentos (
                id SERIAL PRIMARY KEY,
                data VARCHAR(20) NOT NULL,
                hora VARCHAR(10) NOT NULL,
                placa VARCHAR(20) NOT NULL,
                status VARCHAR(20) DEFAULT 'agendado'
            );
        `);
        res.send("<h1>Sucesso! Tabela 'agendamentos' criada. Pode testar o app!</h1>");
    } catch (error) {
        console.error(error);
        res.status(500).send("Erro ao criar tabela: " + error.message);
    }
});

// ========================================================
// ROTAS DA APLICAÇÃO
// ========================================================

// 1. Listar agendamentos
app.get("/agendamentos", async (req, res) => {
  try {
    // Ordenar por data e hora para ficar bonito na lista
    const result = await pool.query(
      "SELECT * FROM agendamentos ORDER BY data, hora"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar agendamentos" });
  }
});

// 2. Criar agendamento (CORRIGIDO: Só existe UM agora)
app.post("/agendamentos", async (req, res) => {
    try {
        // Recebe os dados que vieram do Frontend
        const { data, hora, placa } = req.body; 

        // Insere e devolve o ID gerado (RETURNING *)
        const novoAgendamento = await pool.query(
            "INSERT INTO agendamentos (data, hora, placa, status) VALUES ($1, $2, $3, $4) RETURNING *",
            [data, hora, placa, "agendado"]
        );

        // Devolve o objeto completo para o Frontend
        res.json(novoAgendamento.rows[0]); 

    } catch (err) {
        console.error(err);
        res.status(500).send("Erro no servidor ao criar agendamento");
    }
});

// 3. Atualizar status (Finalizar)
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

// 4. Deletar agendamento
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

// 🚀 Inicialização do Servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});