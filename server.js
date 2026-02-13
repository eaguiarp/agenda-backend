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

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});
