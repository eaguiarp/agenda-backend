require('dotenv').config();

const express    = require("express");
const cors       = require("cors");
const { Pool }   = require("pg");
const path       = require("path");
const basicAuth  = require('express-basic-auth');
const multer     = require('multer');
const fs         = require('fs');
const { Resend } = require('resend');

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
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB por foto (frontend já comprime antes de enviar)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Apenas imagens são aceitas'));
  }
});

// ========================================================
// 📧 RESEND (HTTP — funciona no Railway)
// ========================================================
const resend = new Resend(process.env.RESEND_API_KEY);

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

      // Lê fotos como buffer para o Resend (API HTTP, sem SMTP)
      const attachments = fotos.map((foto, i) => ({
        filename:    `foto-${i + 1}.jpg`,
        content:     fs.readFileSync(foto.path),
        contentType: 'image/jpeg'
      }));

      const { error: resendError } = await resend.emails.send({
        from:        'CD Itaboraí — Anomalias <onboarding@resend.dev>',
        to:          process.env.EMAIL_USER,
        subject:     `🚨 Nova Anomalia Operacional — ${tipo}`,
        attachments,
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
        `
      });

      if (resendError) throw new Error(resendError.message);

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
// 🌤️ ROTA — CLIMA (Open-Meteo, sem chave)
// ========================================================
app.get("/api/weather", async (req, res) => {
  const https = require("https");
  const url = "https://api.open-meteo.com/v1/forecast?latitude=-22.779214&longitude=-42.935105&current_weather=true";
  https.get(url, function(resp) {
    let data = "";
    resp.on("data", function(chunk) { data += chunk; });
    resp.on("end", function() {
      try {
        const w = JSON.parse(data).current_weather;
        const codigos = {
          0:"Céu limpo", 1:"Quase limpo", 2:"Parcialmente nublado", 3:"Nublado",
          45:"Neblina", 48:"Neblina com geada", 51:"Garoa leve", 53:"Garoa moderada",
          55:"Garoa intensa", 61:"Chuva leve", 63:"Chuva moderada", 65:"Chuva forte",
          80:"Pancadas leves", 81:"Pancadas moderadas", 82:"Pancadas fortes",
          95:"Tempestade", 96:"Tempestade c/ granizo", 99:"Tempestade c/ granizo forte"
        };
        res.json({
          temperatura: w.temperature,
          vento:       w.windspeed,
          descricao:   codigos[w.weathercode] || "Condição " + w.weathercode
        });
      } catch(e) { res.status(500).json({ erro: "Erro ao processar clima" }); }
    });
  }).on("error", function() { res.status(500).json({ erro: "Erro ao obter clima" }); });
});

// ========================================================
// 🚗 ROTA — TRÂNSITO (duas chamadas: CD e Serra como origem)
// Chamada 1: CD → destinos diretos (Centro, Manilha, Alcântara, Niterói, Serra, Via Lagos)
// Chamada 2: Serra → Maricá (para somar os dois trechos reais da rota)
// ========================================================
app.get("/api/traffic", async (req, res) => {
  const https  = require("https");
  const apiKey = process.env.MAPS_API_KEY;

  const CD    = "-22.779214,-42.935105"; // CD Itaboraí
  const SERRA = "-22.8590,-42.8260";     // Topo da Serra do Lagarto (checkpoint)

  // Destinos da Chamada 1 (saindo do CD)
  const destsChamada1 = [
    "-22.7471,-42.8596", // 0 — Itaboraí Centro
    "-22.7441,-42.9754", // 1 — Manilha (Trevo)
    "-22.8268,-43.0600", // 2 — Alcântara / RJ-104
    "-22.8736,-43.2075", // 3 — Niterói Centro (final da Ponte)
    "-22.8590,-42.8260", // 4 — Serra do Lagarto (trecho 1 de Maricá)
    "-22.8461,-42.3331"  // 5 — Via Lagos (Rio Bonito)
  ];
  const labelsChamada1 = [
    "ITABORAÍ (CENTRO)",
    "MANILHA (TREVO)",
    "ALCÂNTARA / RJ-104",
    "NITERÓI (CENTRO)",
    "SERRA_TRECHO1",   // interno — não vai para saída final
    "VIA LAGOS"
  ];

  // Destino da Chamada 2 (saindo da Serra → Maricá Centro)
  const destsChamada2 = "-22.9192,-42.8182";

  function fazerChamada(origins, destinations, cb) {
    const url = "https://maps.googleapis.com/maps/api/distancematrix/json" +
      "?origins="      + encodeURIComponent(origins) +
      "&destinations=" + encodeURIComponent(destinations) +
      "&departure_time=now" +
      "&key=" + apiKey;
    let data = "";
    https.get(url, function(resp) {
      resp.on("data",  function(chunk) { data += chunk; });
      resp.on("end",   function() {
        try { cb(null, JSON.parse(data)); }
        catch(e) { cb(e); }
      });
    }).on("error", function(e) { cb(e); });
  }

  // Executa chamada 1: CD → todos os destinos
  fazerChamada(CD, destsChamada1.join("|"), function(err1, data1) {
    if (err1) return res.status(500).json({ erro: "Erro chamada 1" });

    const els1 = data1.rows[0].elements;

    // Extrai trecho 1 da Serra (index 4) para somar depois
    var serraT1 = 0, serraN1 = 0;
    if (els1[4] && els1[4].status === "OK") {
      serraT1 = els1[4].duration_in_traffic ? els1[4].duration_in_traffic.value / 60 : els1[4].duration.value / 60;
      serraN1 = els1[4].duration.value / 60;
    }

    // Executa chamada 2: Serra → Maricá
    fazerChamada(SERRA, destsChamada2, function(err2, data2) {
      if (err2) return res.status(500).json({ erro: "Erro chamada 2" });

      const el2 = data2.rows[0].elements[0];
      var serraT2 = 0, serraN2 = 0;
      if (el2 && el2.status === "OK") {
        serraT2 = el2.duration_in_traffic ? el2.duration_in_traffic.value / 60 : el2.duration.value / 60;
        serraN2 = el2.duration.value / 60;
      }

      // Monta resultado final
      var final = [];

      els1.forEach(function(el, i) {
        var label = labelsChamada1[i];
        if (label === "SERRA_TRECHO1") return; // ignora checkpoint interno

        var comTrafico, normal;
        if (el.status !== "OK") {
          final.push({ destino: label, tempo: 0, atraso: 0, status: "SEM DADOS", cor: "gray" });
          return;
        }
        comTrafico = el.duration_in_traffic ? el.duration_in_traffic.value / 60 : el.duration.value / 60;
        normal     = el.duration.value / 60;

        var atraso = comTrafico - normal;
        var status = "LIVRE"; var cor = "green";
        if (atraso > 15)     { status = "LENTO";    cor = "red";    }
        else if (atraso > 5) { status = "MODERADO"; cor = "yellow"; }

        final.push({ destino: label, tempo: Math.round(comTrafico), atraso: Math.round(atraso), status: status, cor: cor });
      });

      // Maricá = trecho1 (CD→Serra) + trecho2 (Serra→Maricá) — rota real pela Serra do Lagarto
      var maricaTempo  = serraT1 + serraT2;
      var maricaNormal = serraN1 + serraN2;
      var maricaAtraso = maricaTempo - maricaNormal;
      var maricaStatus = "LIVRE"; var maricaCor = "green";
      if (maricaAtraso > 15)     { maricaStatus = "LENTO";    maricaCor = "red";    }
      else if (maricaAtraso > 5) { maricaStatus = "MODERADO"; maricaCor = "yellow"; }

      // Insere Maricá após Niterói (posição 4)
      final.splice(4, 0, {
        destino: "MARICÁ (VIA SERRA)",
        tempo:   Math.round(maricaTempo),
        atraso:  Math.round(maricaAtraso),
        status:  maricaStatus,
        cor:     maricaCor
      });

      res.json(final);
    });
  });
});

// ========================================================
// 🎬 ROTA — LISTA DE VÍDEOS
// ========================================================
app.get("/api/videos", function(req, res) {
  res.json([
    { nome: "Video 1", arquivo: "/video1.mp4" },
    { nome: "Video 2", arquivo: "/video2.mp4" },
    { nome: "Video 3", arquivo: "/video3.mp4" },
    { nome: "Video 4", arquivo: "/video4.mp4" },
    { nome: "Video 5", arquivo: "/video5.mp4" }
  ]);
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

// Express (Node.js)
app.get('/api/config', (req, res) => {
  res.json({ tomtomKey: process.env.TOMTOM_KEY });
});