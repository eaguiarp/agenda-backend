require('dotenv').config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
const basicAuth = require('express-basic-auth');

const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
// 👥 USUÁRIOS
// ========================================================
const USUARIOS = {
    'eduardo':   'senhaMestre',
    'gabriel':   'logistica2026',
    'operacao':  'patio123',
    'tora':      'tora2026',
    'transagil': 'trans2026',
    'portaria':  'portaria2026'
};

// ========================================================
// 🛡️ BLOCO DE SEGURANÇA
// ========================================================
app.use((req, res, next) => {

    // Index — todos os usuários
    if (req.path === '/' || req.path === '/index.html') {
        return basicAuth({
            users: USUARIOS,
            challenge: true,
            realm: 'Painel Logistico Itaborai'
        })(req, res, next);
    }

    // Portaria — Eduardo, Gabriel e Portaria
    if (req.path === '/portaria' || req.path === '/portaria.html') {
        return basicAuth({
            users: {
                'eduardo':  USUARIOS['eduardo'],
                'gabriel':  USUARIOS['gabriel'],
                'portaria': USUARIOS['portaria']
            },
            challenge: true,
            realm: 'Portaria CD Itaborai'
        })(req, res, next);
    }

    // Relatório — apenas Eduardo e Gabriel
    if (req.path === '/relatorio' || req.path === '/relatorio.html') {
        return basicAuth({
            users: {
                'eduardo': USUARIOS['eduardo'],
                'gabriel': USUARIOS['gabriel']
            },
            challenge: true,
            realm: 'Relatorio CD Itaborai'
        })(req, res, next);
    }

    // TV, Consulta, API — livre
    next();
});

// Retorna o usuário logado
app.get("/eu", basicAuth({ users: USUARIOS, challenge: true }), (req, res) => {
    res.json({ usuario: req.auth.user });
});

// ========================================================
// 📁 ARQUIVOS ESTÁTICOS
// ========================================================
app.use(express.static(path.join(__dirname, "public")));

// ========================================================
// 🗄️ BANCO DE DADOS
// ========================================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ========================================================
// 🔧 ROTA DE MIGRAÇÃO
// ========================================================
app.get("/criar-banco", async (req, res) => {
    try {
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

        const colunas = [
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS produto VARCHAR(50)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS alterado_por VARCHAR(50)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS tipo_operacao VARCHAR(20) DEFAULT 'transferencia'",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS quantidade VARCHAR(20)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS nota_fiscal VARCHAR(30)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS transportadora VARCHAR(50)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS hora_entrada VARCHAR(10)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS hora_saida VARCHAR(10)",
    "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS motorista VARCHAR(100)"  
];
        for (const sql of colunas) {
            try { await pool.query(sql); } catch (e) {}
        }

        res.send("<h1>Sucesso! Tabela verificada e atualizada.</h1>");
    } catch (error) {
        res.status(500).send("Erro: " + error.message);
    }
});

// ========================================================
// 🚏 ROTAS DA API
// ========================================================

// Listar agendamentos
app.get("/agendamentos", async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM agendamentos ORDER BY data, hora");
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ erro: "Erro ao buscar dados" });
    }
});

// Criar agendamento
app.post("/agendamentos", async (req, res) => {
    try {
      const {data, hora, placa, produto, alterado_por,
    tipo_operacao, quantidade, nota_fiscal,
    transportadora, hora_entrada, hora_saida, status,
    motorista
} = req.body;

        const result = await pool.query(`
            INSERT INTO agendamentos
                (data, hora, placa, produto, status, alterado_por,
                 tipo_operacao, quantidade, nota_fiscal, transportadora,
                 hora_entrada, hora_saida, motorista)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            RETURNING *`,
            [
                data, hora, placa,
                produto       || 'Geral',
                status        || 'agendado',
                alterado_por  || null,
                tipo_operacao || null,
                quantidade    || null,
                nota_fiscal   || null,
                transportadora|| null,
                hora_entrada  || null,
                hora_saida    || null,
                motorista     || null
            ]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao salvar");
    }
});

// Atualizar agendamento (status, campos extras, etc.)
app.put("/agendamentos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const campos = req.body;

        // Monta a query dinamicamente com os campos enviados
        const chaves = Object.keys(campos);
        if (!chaves.length) {
            return res.status(400).json({ erro: "Nenhum campo enviado" });
        }

        const setClause = chaves.map((k, i) => `${k} = $${i + 1}`).join(", ");
        const valores   = [...chaves.map(k => campos[k]), id];

        await pool.query(
            `UPDATE agendamentos SET ${setClause} WHERE id = $${chaves.length + 1}`,
            valores
        );

        res.json({ sucesso: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ erro: "Erro ao atualizar" });
    }
});

// Deletar agendamento
app.delete("/agendamentos/:id", async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("DELETE FROM agendamentos WHERE id = $1", [id]);
        res.json({ sucesso: true });
    } catch (error) {
        res.status(500).json({ erro: "Erro ao deletar" });
    }
});

// ========================================================
// 🖥️ ROTAS DE PÁGINAS
// ========================================================
app.get("/tv",       (req, res) => res.sendFile(__dirname + "/public/tv.html"));
app.get("/mobile",   (req, res) => res.sendFile(__dirname + "/public/mobile.html"));
app.get("/portaria", (req, res) => res.sendFile(__dirname + "/public/portaria.html"));
app.get("/relatorio",(req, res) => res.sendFile(__dirname + "/public/relatorio.html"));

// ========================================================
// 🚀 START
// ========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log("Servidor rodando na porta " + PORT);
});