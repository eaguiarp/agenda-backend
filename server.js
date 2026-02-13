
require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURAÇÃO DO BANCO (vamos trocar depois pela do Railway)
app.get("/", (req, res) => {
  res.send("Servidor da Agenda funcionando 🚀");
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});





// Teste

app.get("/teste-insert", async (req, res) => {
  await pool.query(
    "INSERT INTO agendamentos (empresa, data, horario, nome) VALUES ($1, $2, $3, $4)",
    ["CSN", "2026-02-14", "08:00", "Transportadora X"]
  );

  res.send("Inserido com sucesso!");
});



app.get("/", (req, res) => {
  res.send("Servidor da Agenda funcionando 🚀");
});

// Listar agendamentos
app.get("/agendamentos", async (req, res) => {
  const result = await pool.query("SELECT * FROM agendamentos ORDER BY data");
  res.json(result.rows);
});

// Criar agendamento
app.post("/agendamentos", async (req, res) => {
  const { empresa, data, horario, nome } = req.body;

  await pool.query(
    "INSERT INTO agendamentos (empresa, data, horario, nome) VALUES ($1, $2, $3, $4)",
    [empresa, data, horario, nome]
  );

  res.json({ sucesso: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Servidor rodando na porta " + PORT);
});
