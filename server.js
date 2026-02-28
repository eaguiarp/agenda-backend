require('dotenv').config();

const express    = require("express");
const cors       = require("cors");
const { Pool }   = require("pg");
const path       = require("path");
const basicAuth  = require('express-basic-auth');
const multer     = require('multer');
const fs         = require('fs');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// ========================================================
// 📁 PASTA DE UPLOADS TEMPORÁRIOS
// ========================================================
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename:    (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB por foto
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são aceitas'));
  }
});

// ========================================================
// 📧 NODEMAILER
// ========================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ========================================================
// 🗄️ BANCO DE DADOS
// ========================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ========================================================
// 🔑 HIERARQUIA DE PERFIS
// admin(4) > relatorio(3) > portaria(2) > operacao(1)
// ========================================================
const NIVEL = { admin: 4, relatorio: 3, portaria: 2, operacao: 1 };

async function verificarAcesso(user, pass, nivelMinimo) {
  try {
    const result = await pool.query(
      "SELECT perfil FROM usuarios WHERE nome = $1 AND senha = $2",
      [user, pass]
    );
    if (!result.rows.length) return false;
    const nivel = NIVEL[result.rows[0].perfil] || 1;
    return nivel >= nivelMinimo;
  } catch (e) {
    console.error("Erro ao verificar acesso:", e);
    return false;
  }
}

function auth(nivelMinimo, realm) {
  return basicAuth({
    authorizer: (user, pass, cb) => {
      verificarAcesso(user, pass, nivelMinimo)
        .then(ok => cb(null, ok))
        .catch(() => cb(null, false));
    },
    authorizeAsync: true,
    challenge: true,
    realm
  });
}

// ========================================================
// 🛡️ BLOCO DE SEGURANÇA
// ========================================================
app.use((req, res, next) => {

  if (req.path === '/' || req.path === '/index.html') {
    return auth(1, 'Painel Logistico Itaborai')(req, res, next);
  }

  if (req.path === '/portaria' || req.path === '/portaria.html') {
    return auth(2, 'Portaria CD Itaborai')(req, res, next);
  }

  if (req.path === '/relatorio' || req.path === '/relatorio.html') {
    return auth(3, 'Relatorio CD Itaborai')(req, res, next);
  }

  next();
});

app.get("/eu", auth(1, 'CD Itaborai'), (req, res) => {
  res.json({ usuario: req.auth.user });
});

// ========================================================
// 📁 ARQUIVOS ESTÁTICOS
// ========================================================
app.use(express.static(path.join(__dirname, "public")));

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
      "ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS motorista VARCHAR(100)",
      "ALTER TABLE agendamentos ALTER COLUMN produto TYPE VARCHAR(500)"
    ];

    for (const sql of colunas) {
      try { await pool.query(sql); } catch (e) {}
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bloqueios (
        id SERIAL PRIMARY KEY,
        data_inicio VARCHAR(20) NOT NULL,
        data_fim    VARCHAR(20) NOT NULL,
        hora_inicio VARCHAR(10),
        hora_fim    VARCHAR(10),
        motivo      VARCHAR(200),
        criado_por  VARCHAR(50),
        criado_em   TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id        SERIAL PRIMARY KEY,
        nome      VARCHAR(50) UNIQUE NOT NULL,
        senha     VARCHAR(100) NOT NULL,
        perfil    VARCHAR(20) DEFAULT 'operacao',
        criado_em TIMESTAMP DEFAULT NOW()
      );
    `);

    const usuariosPadrao = [
      { nome: 'eduardo',   senha: 'senhaMestre1',  perfil: 'admin'     },
      { nome: 'gabriel',   senha: 'logistica2026', perfil: 'relatorio' },
      { nome: 'portaria',  senha: 'portaria2026',  perfil: 'portaria'  },
      { nome: 'operacao',  senha: 'patio123',      perfil: 'operacao'  },
      { nome: 'tora',      senha: 'tora2026',      perfil: 'operacao'  },
      { nome: 'transagil', senha: 'trans2026',     perfil: 'operacao'  },
      { nome: 'uillian',   senha: 'uillian2026',   perfil: 'operacao'  },
      { nome: 'fabiano',   senha: 'fabiano2026',   perfil: 'operacao'  },
    ];

    for (const u of usuariosPadrao) {
      try {
        await pool.query(
          "INSERT INTO usuarios (nome, senha, perfil) VALUES ($1, $2, $3) ON CONFLICT (nome) DO NOTHING",
          [u.nome, u.senha, u.perfil]
        );
      } catch (e) {}
    }

    res.send("<h1>✅ Sucesso! Tabelas verificadas e atualizadas.</h1>");
  } catch (error) {
    res.status(500).send("Erro: " + error.message);
  }
});

// ========================================================
// 🚨 ROTA — ANOMALIAS
// portaria(2) ou superior
// ========================================================
app.post('/anomalia',
  auth(2, 'Registro de Anomalia'),
  upload.array('fotos', 3),
  async (req, res) => {
    const fotos = req.files || [];

    try {
      const { tipo, descricao } = req.body;
      const usuario = req.auth.user;

      const agora = new Date();
      const dataHora = agora.toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day:    '2-digit',
        month:  '2-digit',
        year:   'numeric',
        hour:   '2-digit',
        minute: '2-digit'
      });

      await transporter.sendMail({
        from:    `"CD Itaboraí — Anomalias" <${process.env.EMAIL_USER}>`,
        to:      process.env.EMAIL_USER,
        subject: `🚨 Nova Anomalia Operacional — ${tipo}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#b52a2a;padding:20px 24px;border-radius:6px 6px 0 0;">
              <h2 style="color:white;margin:0;font-size:1.2rem;">🚨 Nova Anomalia Operacional</h2>
            </div>
            <div style="border:1px solid #e0ddd6;border-top:none;padding:24px;border-radius:0 0 6px 6px;">
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="padding:8px 0;color:#888;font-size:0.85rem;width:140px;">Tipo</td>
                  <td style="padding:8px 0;font-weight:700;color:#b52a2a;">${tipo}</td>
                </tr>
                <tr style="border-top:1px solid #f0ede6;">
                  <td style="padding:8px 0;color:#888;font-size:0.85rem;">Registrado em</td>
                  <td style="padding:8px 0;font-family:monospace;">${dataHora}</td>
                </tr>
                <tr style="border-top:1px solid #f0ede6;">
                  <td style="padding:8px 0;color:#888;font-size:0.85rem;">Usuário</td>
                  <td style="padding:8px 0;font-family:monospace;">${usuario}</td>
                </tr>
                <tr style="border-top:1px solid #f0ede6;">
                  <td style="padding:8px 0;color:#888;font-size:0.85rem;vertical-align:top;">Descrição</td>
                  <td style="padding:8px 0;line-height:1.6;">${(descricao || '').replace(/\n/g, '<br>')}</td>
                </tr>
                ${fotos.length > 0 ? `
                <tr style="border-top:1px solid #f0ede6;">
                  <td style="padding:8px 0;color:#888;font-size:0.85rem;">Fotos</td>
                  <td style="padding:8px 0;">${fotos.length} foto(s) anexada(s)</td>
                </tr>` : ''}
              </table>
            </div>
            <p style="font-size:0.72rem;color:#aaa;margin-top:12px;text-align:center;">
              CD Itaboraí · Sistema de Gestão Logística
            </p>
          </div>
        `,
        attachments: fotos.map(foto => ({
          filename: foto.originalname || foto.filename,
          path:     foto.path
        }))
      });

      // Apaga fotos temporárias após envio
      fotos.forEach(foto => {
        fs.unlink(foto.path, err => {
          if (err) console.error("Erro ao deletar arquivo:", err);
        });
      });

      res.json({ sucesso: true });

    } catch (err) {
      console.error("Erro ao enviar anomalia:", err);

      // Tenta apagar fotos mesmo em caso de erro
      fotos.forEach(foto => {
        fs.unlink(foto.path, () => {});
      });

      res.status(500).json({ erro: 'Erro ao registrar anomalia. Tente novamente.' });
    }
  }
);

// ========================================================
// 🚏 ROTAS — AGENDAMENTOS
// ========================================================
app.get("/agendamentos", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM agendamentos ORDER BY data, hora");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar dados" });
  }
});

app.post("/agendamentos", async (req, res) => {
  try {
    const {
      data, hora, placa, produto, alterado_por,
      tipo_operacao, quantidade, nota_fiscal,
      transportadora, hora_entrada, hora_saida, status, motorista
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
        produto        || 'Geral',
        status         || 'agendado',
        alterado_por   || null,
        tipo_operacao  || null,
        quantidade     || null,
        nota_fiscal    || null,
        transportadora || null,
        hora_entrada   || null,
        hora_saida     || null,
        motorista      || null
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Erro ao salvar");
  }
});

app.put("/agendamentos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const campos  = req.body;
    const chaves  = Object.keys(campos);
    if (!chaves.length) return res.status(400).json({ erro: "Nenhum campo enviado" });
    const setClause = chaves.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const valores   = [...chaves.map(k => campos[k]), id];
    await pool.query(`UPDATE agendamentos SET ${setClause} WHERE id = $${chaves.length + 1}`, valores);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar" });
  }
});

app.delete("/agendamentos/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM agendamentos WHERE id = $1", [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar" });
  }
});

// ========================================================
// 🚫 ROTAS — BLOQUEIOS
// ========================================================
app.get("/bloqueios", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM bloqueios ORDER BY data_inicio, hora_inicio");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar bloqueios" });
  }
});

app.post("/bloqueios", async (req, res) => {
  try {
    const { data_inicio, data_fim, hora_inicio, hora_fim, motivo, criado_por } = req.body;
    if (!data_inicio || !data_fim) return res.status(400).json({ erro: "Datas obrigatórias" });
    const result = await pool.query(
      "INSERT INTO bloqueios (data_inicio, data_fim, hora_inicio, hora_fim, motivo, criado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [data_inicio, data_fim, hora_inicio || null, hora_fim || null, motivo || null, criado_por || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Erro ao criar bloqueio");
  }
});

app.delete("/bloqueios/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM bloqueios WHERE id = $1", [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar bloqueio" });
  }
});

// ========================================================
// 👥 ROTAS — USUÁRIOS
// ========================================================
app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, nome, perfil, criado_em FROM usuarios ORDER BY nome");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, senha, perfil } = req.body;
    if (!nome || !senha) return res.status(400).json({ erro: "Nome e senha obrigatórios" });
    const result = await pool.query(
      "INSERT INTO usuarios (nome, senha, perfil) VALUES ($1, $2, $3) RETURNING id, nome, perfil",
      [nome.toLowerCase().trim(), senha, perfil || 'operacao']
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: "Usuário já existe" });
    res.status(500).json({ erro: "Erro ao criar usuário" });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  try {
    const { senha, perfil } = req.body;
    const campos = [], valores = [];
    if (senha)  { campos.push(`senha  = $${campos.length + 1}`); valores.push(senha); }
    if (perfil) { campos.push(`perfil = $${campos.length + 1}`); valores.push(perfil); }
    if (!campos.length) return res.status(400).json({ erro: "Nada para atualizar" });
    valores.push(req.params.id);
    await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${valores.length}`, valores);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao atualizar usuário" });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM usuarios WHERE id = $1", [req.params.id]);
    res.json({ sucesso: true });
  } catch (error) {
    res.status(500).json({ erro: "Erro ao deletar usuário" });
  }
});

// ========================================================
// 🖥️ ROTAS DE PÁGINAS
// ========================================================
app.get("/tv",        (req, res) => res.sendFile(__dirname + "/public/tv.html"));
app.get("/mobile",    (req, res) => res.sendFile(__dirname + "/public/mobile.html"));
app.get("/portaria",  (req, res) => res.sendFile(__dirname + "/public/portaria.html"));
app.get("/relatorio", (req, res) => res.sendFile(__dirname + "/public/relatorio.html"));

// ========================================================
// 🚀 START
// ========================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta " + PORT);
});