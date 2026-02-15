require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path"); // <--- NOVO: Importante para achar a pasta

const app = express();
app.use(cors());
app.use(express.json());

// --- MUDANÇA AQUI: Servir os arquivos do Frontend (Pasta public) ---
app.use(express.static(path.join(__dirname, "public")));

// Configuração do banco (Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ========================================================
// ROTA MÁGICA (Para criar o banco, se precisar rodar de novo)
// ========================================================
app.get("/criar-banco", async (req, res) => {
    // ... (mantém igual ao que te passei antes) ...
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
        res.send("<h1>Sucesso! Tabela criada.</h1>");
    } catch (error) {
        res.status(500).send("Erro: " + error.message);
    }
});

// ========================================================
// ROTAS DA API (Backend)
// ========================================================

// Listar
app.get("/agendamentos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM agendamentos ORDER BY data, hora");
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ erro: "Erro ao buscar dados" });
  }
});

// Criar
app.post("/agendamentos", async (req, res) => {
    try {
        const { data, hora, placa } = req.body; 
        const novoAgendamento = await pool.query(
            "INSERT INTO agendamentos (data, hora, placa, status) VALUES ($1, $2, $3, $4) RETURNING *",
            [data, hora, placa, "agendado"]
        );
        res.json(novoAgendamento.rows[0]); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao salvar");
    }
});

// Atualizar e Deletar (mantém igual ao anterior...)
app.put("/agendamentos/:id", async (req, res) => {
    // ... (copiar do código anterior)
    try {
        const { id } = req.params;
        const { status } = req.body;
        await pool.query("UPDATE agendamentos SET status = $1 WHERE id = $2", [status, id]);
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ erro: "Erro" }); }
});

app.delete("/agendamentos/:id", async (req, res) => {
    // ... (copiar do código anterior)
     try {
        const { id } = req.params;
        await pool.query("DELETE FROM agendamentos WHERE id = $1", [id]);
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ erro: "Erro" }); }
});

// 🚀 Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});