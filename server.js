require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const basicAuth = require('express-basic-auth'); // <--- 1. Importação da Segurança

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

console.log("YT:", process.env.YOUTUBE_API_KEY);

// ========================================================
// 🛡️ BLOCO DE SEGURANÇA (A PORTARIA)
// ========================================================
// Colocamos isso ANTES de servir os arquivos.
app.use((req, res, next) => {
    // Se for a raiz (/) ou o index.html, pede senha.
    if (req.path === '/' || req.path === '/index.html') {
        return basicAuth({
           users: { 
    'eduardo': 'senhaMestre', 
    'gabriel': 'logistica2026', 
    'operacao': 'patio123',
    'tora': "tora2026",
    'transagil': "trans2026" 
}, // <--- TROQUE SUA SENHA AQUI
            challenge: true, // Faz aparecer a janelinha do navegador
            realm: 'Painel Logistico Itaborai'
        })(req, res, next);
    }
    // Se for TV, Consulta ou API, deixa passar direto.
    next();
});

// --- Servir os arquivos do Frontend (Pasta public) ---
app.use(express.static(path.join(__dirname, "public")));

// Configuração do banco (Railway)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ========================================================
// ROTA MÁGICA (Para criar o banco com a nova coluna PRODUTO)
// ========================================================
app.get("/criar-banco", async (req, res) => {
    try {
        // Adicionei a coluna 'produto' aqui
        await pool.query(`
            CREATE TABLE IF NOT EXISTS agendamentos (
                id SERIAL PRIMARY KEY,
                data VARCHAR(20) NOT NULL,
                hora VARCHAR(10) NOT NULL,
                placa VARCHAR(20) NOT NULL,
                produto VARCHAR(50), 
                status VARCHAR(20) DEFAULT 'agendado'
            );
        `);
        
        // Tenta adicionar a coluna caso a tabela já exista (Migração simples)
        try {
            await pool.query("ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS produto VARCHAR(50);");
        } catch (e) { console.log("Coluna produto já existe ou erro ignorável."); }

        res.send("<h1>Sucesso! Tabela verificada e atualizada.</h1>");
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


// Criar (ATUALIZADO PARA SALVAR O PRODUTO)
app.post("/agendamentos", async (req, res) => {
    try {
        // Agora recebemos 'produto' também
        const { data, hora, placa, produto } = req.body; 
        
        const novoAgendamento = await pool.query(
            "INSERT INTO agendamentos (data, hora, placa, produto, status) VALUES ($1, $2, $3, $4, $5) RETURNING *",
            [data, hora, placa, produto || 'Geral', "agendado"] // Se não vier produto, salva 'Geral'
        );
        res.json(novoAgendamento.rows[0]); 
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao salvar");
    }
});

// Atualizar Status (Chamar, Carregando, Finalizar)
app.put("/agendamentos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        // Ajuste pequeno para garantir que funciona com qualquer status
        await pool.query("UPDATE agendamentos SET status = $1 WHERE id = $2", [status, id]);
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ erro: "Erro ao atualizar" }); }
});

// Deletar
app.delete("/agendamentos/:id", async (req, res) => {
     try {
        const { id } = req.params;
        await pool.query("DELETE FROM agendamentos WHERE id = $1", [id]);
        res.json({ sucesso: true });
    } catch (error) { res.status(500).json({ erro: "Erro ao deletar" }); }
});


app.get("/bandnews-live", async (req, res) => {
    try {
        const channelId = "UCWijW6tW0iI5ghsAbWDFtTg"; // exemplo canal BandNews FM

        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&eventType=live&type=video&key=${YOUTUBE_API_KEY}`
        );

        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const videoId = data.items[0].id.videoId;
            res.json({ videoId });
        } else {
            res.json({ message: "Nenhuma live ativa agora" });
        }

    } catch (error) {
        console.error(error);
        res.status(500).json({ erro: "Erro ao buscar live" });
    }
});


// 🚀 Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});