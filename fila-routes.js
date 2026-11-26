// fila-routes.js — Fila online de motoristas (AgendaCD)
// Uso no server.js (depois de criar `app` e `pool`):
//   require('./fila-routes')(app, pool);
//
// Variáveis de ambiente (Railway):
//   FILA_MONITOR_KEY  chave do monitor da portaria (obrigatória)
//   FILA_ADMIN_KEY    chave da faturista/operadores (obrigatória)
//   FILA_BASE_URL     ex.: https://seu-app.up.railway.app  (obrigatória)
//   FILA_HORA_INICIO  hora de abertura, padrão 0
//   FILA_HORA_FIM     hora de fechamento, padrão 23
//   FILA_BLOQUEIO_HORAS horas mínimas após finalizar no modo normal, padrão 1
//   FILA_GEO_LAT, FILA_GEO_LNG, FILA_GEO_RAIO_M   (opcional) trava por localização

const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');

const TZ = 'America/Sao_Paulo';
const STATUS_VALIDOS = ['aguardando', 'chamado', 'carregando', 'finalizado', 'ausente', 'cancelado'];
const STATUS_COM_MOTIVO = ['ausente', 'cancelado'];
const RE_PLACA = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/; // antiga (ABC1234) e Mercosul (ABC1D23)

const cfg = {
  monitorKey: process.env.FILA_MONITOR_KEY || '',
  adminKey: process.env.FILA_ADMIN_KEY || '',
  baseUrl: (process.env.FILA_BASE_URL || '').replace(/\/$/, ''),
  horaInicio: parseInt(process.env.FILA_HORA_INICIO || '0', 10),
  horaFim: parseInt(process.env.FILA_HORA_FIM || '23', 10),
  bloqueioHoras: Number.isFinite(parseFloat(process.env.FILA_BLOQUEIO_HORAS))
    ? parseFloat(process.env.FILA_BLOQUEIO_HORAS)
    : 1,
  tokenSeg: 45,
  sessaoSeg: 180,
  maxPorIp10min: 5,
  geoLat: parseFloat(process.env.FILA_GEO_LAT),
  geoLng: parseFloat(process.env.FILA_GEO_LNG),
  geoRaio: parseFloat(process.env.FILA_GEO_RAIO_M || '300'),
};
cfg.geoAtiva = Number.isFinite(cfg.geoLat) && Number.isFinite(cfg.geoLng);

function igual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(x, y);
}

function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function ipDe(req) {
  const xf = req.headers['x-forwarded-for'];
  const raw = xf ? String(xf).split(',').pop().trim() : req.socket.remoteAddress || '';
  return raw.slice(0, 64);
}

module.exports = function montarFila(app, pool) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  async function garantirEstrutura() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fila_config (
        id int PRIMARY KEY DEFAULT 1,
        modo text NOT NULL DEFAULT 'normal',
        alterado_em timestamptz NOT NULL DEFAULT now(),
        alterado_por text
      )
    `);
    await pool.query(`
      INSERT INTO fila_config (id, modo, alterado_por)
      VALUES (1, 'normal', 'sistema')
      ON CONFLICT (id) DO NOTHING
    `);
    await pool.query(`
      ALTER TABLE fila_motoristas
        ADD COLUMN IF NOT EXISTS em_contingencia boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS retido_de date,
        ADD COLUMN IF NOT EXISTS revalidado_em timestamptz
    `);
    // Remove índice único diário antigo para permitir múltiplas entradas no modo normal
   await pool.query(`
      ALTER TABLE fila_motoristas
        DROP CONSTRAINT IF EXISTS fila_motoristas_data_fila_placa_key
    `);
    await pool.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN (
          SELECT indexname
          FROM pg_indexes
          WHERE tablename = 'fila_motoristas'
            AND indexdef ILIKE '%UNIQUE%'
            AND indexdef ILIKE '%placa%'
            AND indexdef ILIKE '%data_fila%'
        ) LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
        END LOOP;
      END $$;
    `);
  }

  let estruturaPronta = null;
  function assegurarBanco() {
    if (!estruturaPronta) {
      estruturaPronta = garantirEstrutura().catch((e) => {
        estruturaPronta = null;
        throw e;
      });
    }
    return estruturaPronta;
  }

  const exigirMonitor = (req, res, next) => {
    if (igual(req.query.chave || req.headers['x-fila-chave'], cfg.monitorKey)) {
      next();
    } else {
      res.status(401).json({ erro: 'Chave do monitor inválida.' });
    }
  };

  const exigirAdmin = (req, res, next) => {
    if (igual(req.headers['x-fila-admin'], cfg.adminKey)) {
      next();
    } else {
      res.status(401).json({ erro: 'Chave de acesso inválida.' });
    }
  };

  async function infoRelogio() {
    await assegurarBanco();
    const { rows } = await pool.query(`
      SELECT
        (now() AT TIME ZONE $1)::date AS hoje,
        ((now() AT TIME ZONE $1)::date - 1) AS ontem,
        extract(hour FROM now() AT TIME ZONE $1)::int AS hora,
        extract(minute FROM now() AT TIME ZONE $1)::int AS minuto
    `, [TZ]);
    return rows[0];
  }

  async function janela() {
    const r = await infoRelogio();
    const h = r.hora;
    if (h >= cfg.horaInicio && h < cfg.horaFim) {
      return { aberta: true, hora: h, hoje: r.hoje, ontem: r.ontem };
    } else {
      return { aberta: false, hora: h, hoje: r.hoje, ontem: r.ontem };
    }
  }

  const msgFechada = () =>
    `Fila online fechada. Funciona das ${String(cfg.horaInicio).padStart(2, '0')}h às ${String(cfg.horaFim).padStart(2, '0')}h.`;

  async function obterModo() {
    await assegurarBanco();
    const { rows } = await pool.query(
      `SELECT modo, to_char(alterado_em AT TIME ZONE $1, 'DD/MM/YYYY HH24:MI:SS') AS alterado_em, alterado_por
         FROM fila_config WHERE id = 1`,
      [TZ]
    );
    return rows[0] || { modo: 'normal', alterado_em: null, alterado_por: null };
  }

  // Promove retidos de ontem (00h–18h sem finalizar) e marca ausentes após 07h
  async function processarCicloContingencia() {
    const rel = await infoRelogio();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Retenção de ontem (00h às 18h, em contingência, não finalizado) -> entra no dia atual para revalidar das 06h às 07h
      await client.query(`
        UPDATE fila_motoristas
           SET data_fila = $1::date,
               retido_de = data_fila,
               revalidado_em = NULL
         WHERE data_fila = $2::date
           AND retido_de IS NULL
           AND em_contingencia = true
           AND status <> 'finalizado'
           AND status <> 'cancelado'
           AND status <> 'ausente'
           AND extract(hour FROM registrado_em AT TIME ZONE $3)::int >= 0
           AND extract(hour FROM registrado_em AT TIME ZONE $3)::int < 18
      `, [rel.hoje, rel.ontem, TZ]);

      // 2. Após 07:00, quem estava retido e não revalidou entre 06:00 e 07:00 vira ausente
      if (rel.hora >= 7) {
        const ausentes = await client.query(`
          UPDATE fila_motoristas
             SET status = 'ausente',
                 motivo = 'Não revalidou entre 06h e 07h',
                 status_alterado_em = now(),
                 status_alterado_por = 'sistema'
           WHERE data_fila = $1::date
             AND retido_de IS NOT NULL
             AND revalidado_em IS NULL
             AND status = 'aguardando'
          RETURNING id
        `, [rel.hoje]);

        for (const row of ausentes.rows) {
          await client.query(`
            INSERT INTO fila_log (fila_id, status_anterior, status_novo, motivo, operador)
            VALUES ($1, 'aguardando', 'ausente', 'Não revalidou entre 06h e 07h', 'sistema')
          `, [row.id]);
        }
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  const SQL_ORDEM = `
    CASE
      WHEN retido_de IS NOT NULL AND revalidado_em IS NOT NULL THEN 0
      WHEN retido_de IS NOT NULL AND revalidado_em IS NULL THEN 1
      ELSE 2
    END,
    registrado_em,
    id
  `;

  async function posicaoDe(client, id) {
    const { rows } = await client.query(`
      WITH ordenada AS (
        SELECT id, row_number() OVER (PARTITION BY data_fila ORDER BY ${SQL_ORDEM})::int AS pos
          FROM fila_motoristas
         WHERE data_fila = (SELECT data_fila FROM fila_motoristas WHERE id = $1)
      )
      SELECT pos FROM ordenada WHERE id = $1
    `, [id]);
    return rows[0] ? rows[0].pos : 1;
  }

  const SQL_HORA = `to_char(registrado_em AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS')`;

  // ---------- IMAGEM QR ----------

  router.get('/qr.png', exigirMonitor, async (req, res) => {
    const texto = req.query.texto;
    if (typeof texto !== 'string' || !texto || texto.length > 2048) {
      return res.status(400).send('Parâmetro "texto" obrigatório (máximo de 2048 caracteres).');
    }

    try {
      const bufferPng = await QRCode.toBuffer(texto, {
        errorCorrectionLevel: 'M',
        margin: 4,
        scale: 6,
      });
      res.type('png').set('Cache-Control', 'no-store').send(bufferPng);
    } catch (e) {
      console.error('fila qr imagem', e);
      res.status(500).send('Erro ao gerar QR Code.');
    }
  });

  // ---------- MONITOR DA PORTARIA ----------

  router.get('/qr-atual', exigirMonitor, async (req, res) => {
    try {
      await processarCicloContingencia();
      const j = await janela();
      if (!j.aberta) {
        return res.status(403).json({ fechada: true, erro: msgFechada() });
      }
      const token = crypto.randomBytes(16).toString('hex');
      const { rows } = await pool.query(
        `INSERT INTO fila_tokens (token, expira_em)
         VALUES ($1, now() + make_interval(secs => $2))
         RETURNING token, extract(epoch FROM (expira_em - now()))*1000 AS restante_ms`,
        [token, cfg.tokenSeg]
      );
      if (Math.random() < 0.05) {
        pool.query(`DELETE FROM fila_tokens WHERE criado_em < now() - interval '2 days'`).catch(() => {});
      }
      res.json({
        token,
        url: `${cfg.baseUrl}/fila.html?k=${token}`,
        restante_ms: Math.round(rows[0].restante_ms),
      });
    } catch (e) {
      console.error('fila qr-atual', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  router.get('/qr-status', exigirMonitor, async (req, res) => {
    try {
      await assegurarBanco();
      const { rows } = await pool.query(
        `SELECT (usado_em IS NOT NULL) AS usado, (expira_em <= now()) AS expirado
         FROM fila_tokens WHERE token = $1`,
        [String(req.query.t || '')]
      );
      if (!rows.length) {
        return res.json({ usado: true, expirado: true });
      }
      res.json(rows[0]);
    } catch (e) {
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // ---------- MOTORISTA ----------

  router.post('/entrar', async (req, res) => {
    try {
      await processarCicloContingencia();
      const k = String((req.body && req.body.k) || '');
      if (!/^[a-f0-9]{32}$/.test(k)) {
        return res.status(400).json({ erro: 'QR inválido. Escaneie o QR da portaria.' });
      }
      const j = await janela();
      if (!j.aberta) {
        return res.status(403).json({ erro: msgFechada() });
      }

      const sessao = crypto.randomBytes(16).toString('hex');
      const r = await pool.query(
        `UPDATE fila_tokens
            SET usado_em = now(), sessao = $2, ip = $4,
                sessao_expira = now() + make_interval(secs => $3)
          WHERE token = $1 AND usado_em IS NULL AND expira_em > now()
          RETURNING extract(epoch FROM (sessao_expira - now())) AS restante_s`,
        [k, sessao, cfg.sessaoSeg, ipDe(req)]
      );
      if (!r.rowCount) {
        return res.status(410).json({ erro: 'QR expirado ou já utilizado. Escaneie novamente o QR que está na portaria.' });
      }
      const infoModo = await obterModo();
      res.json({
        sessao,
        restante_s: Math.round(r.rows[0].restante_s),
        geo: cfg.geoAtiva,
        modo: infoModo.modo,
      });
    } catch (e) {
      console.error('fila entrar', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // Revalidação direta pelo celular (janela 06:00–07:00 para retidos)
  router.post('/revalidar', async (req, res) => {
    try {
      await processarCicloContingencia();
      const rel = await infoRelogio();
      const placa = String((req.body && req.body.placa) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const registroId = parseInt(req.body && req.body.id, 10);

      if (rel.hora !== 6) {
        return res.status(403).json({ erro: 'A revalidação de presença ocorre das 06h às 07h.' });
      }
      if (!RE_PLACA.test(placa)) {
        return res.status(400).json({ erro: 'Placa inválida.' });
      }

      const filtroId = Number.isInteger(registroId) && registroId > 0 ? 'AND id = $3' : '';
      const params = Number.isInteger(registroId) && registroId > 0
        ? [placa, rel.hoje, registroId]
        : [placa, rel.hoje];

      const { rows } = await pool.query(`
        UPDATE fila_motoristas
           SET revalidado_em = COALESCE(revalidado_em, now())
         WHERE placa = $1
           AND data_fila = $2::date
           AND retido_de IS NOT NULL
           AND status = 'aguardando'
           ${filtroId}
        RETURNING id, placa, nome, ${SQL_HORA} AS registrado_txt
      `, params);

      if (!rows.length) {
        return res.status(404).json({ erro: 'Nenhuma retenção pendente de revalidação encontrada para esta placa.' });
      }

      const posicao = await posicaoDe(pool, rows[0].id);
      res.json({
        ok: true,
        revalidado: true,
        posicao,
        placa: rows[0].placa,
        nome: rows[0].nome,
        registrado_em: rows[0].registrado_txt,
      });
    } catch (e) {
      console.error('fila revalidar', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  router.post('/registrar', async (req, res) => {
    const b = req.body || {};
    const placa = String(b.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nome = String(b.nome || '').trim().split(/\s+/)[0].slice(0, 40);
    const sessao = String(b.sessao || '');

    if (!RE_PLACA.test(placa)) {
      return res.status(400).json({ erro: 'Placa inválida. Exemplos: ABC1234 ou ABC1D23.' });
    }
    if (nome.length < 2 || !/^[\p{L}'-]+$/u.test(nome)) {
      return res.status(400).json({ erro: 'Informe seu primeiro nome.' });
    }
    if (!/^[a-f0-9]{32}$/.test(sessao)) {
      return res.status(401).json({ erro: 'Sessão inválida. Escaneie o QR da portaria.' });
    }

    let lat = null;
    let lng = null;
    if (cfg.geoAtiva) {
      lat = parseFloat(b.lat);
      lng = parseFloat(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ erro: 'Ative a localização do celular para registrar.' });
      }
      if (distanciaM(cfg.geoLat, cfg.geoLng, lat, lng) > cfg.geoRaio) {
        return res.status(403).json({ erro: 'Você precisa estar no pátio do CD para entrar na fila.' });
      }
    } else if (Number.isFinite(parseFloat(b.lat)) && Number.isFinite(parseFloat(b.lng))) {
      lat = parseFloat(b.lat);
      lng = parseFloat(b.lng);
    }

    try {
      await processarCicloContingencia();
      const j = await janela();
      if (!j.aberta) {
        return res.status(403).json({ erro: msgFechada() });
      }

      const lim = await pool.query(
        `SELECT count(*)::int AS n FROM fila_motoristas
          WHERE ip = $1 AND registrado_em > now() - interval '10 minutes'`,
        [ipDe(req)]
      );
      if (lim.rows[0].n >= cfg.maxPorIp10min) {
        return res.status(429).json({ erro: 'Muitos registros deste aparelho. Procure a portaria.' });
      }
    } catch (e) {
      return res.status(500).json({ erro: 'Erro interno.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const s = await client.query(
        `UPDATE fila_tokens SET sessao_usada_em = now()
          WHERE sessao = $1 AND sessao_usada_em IS NULL AND sessao_expira > now()
          RETURNING token`,
        [sessao]
      );
      if (!s.rowCount) {
        await client.query('ROLLBACK');
        return res.status(401).json({ erro: 'Sessão expirada. Escaneie novamente o QR da portaria.' });
      }

      const rel = await infoRelogio();
      const infoModo = await obterModo();
      const emContingencia = infoModo.modo === 'contingencia';

      // Janela 06h–07h: se escaneou QR e a placa já está na tabela retida como 'aguardando', revalida presença
      if (rel.hora === 6) {
        const retido = await client.query(`
          UPDATE fila_motoristas
             SET revalidado_em = COALESCE(revalidado_em, now())
           WHERE placa = $1
             AND data_fila = $2::date
             AND retido_de IS NOT NULL
             AND status = 'aguardando'
          RETURNING id, placa, nome, ${SQL_HORA} AS registrado_txt
        `, [placa, rel.hoje]);

        if (retido.rowCount) {
          await client.query('COMMIT');
          const posicao = await posicaoDe(pool, retido.rows[0].id);
          return res.json({
            ok: true,
            revalidado: true,
            posicao,
            placa: retido.rows[0].placa,
            nome: retido.rows[0].nome,
            registrado_em: retido.rows[0].registrado_txt,
          });
        }
      }

      // Verifica se já existe registro ativo em andamento para a placa hoje
      const ativoHoje = await client.query(`
        SELECT id, status, ${SQL_HORA} AS registrado_txt
          FROM fila_motoristas
         WHERE placa = $1
           AND data_fila = $2::date
           AND status IN ('aguardando', 'chamado', 'carregando')
         ORDER BY id DESC LIMIT 1
      `, [placa, rel.hoje]);

      if (ativoHoje.rowCount) {
        await client.query('ROLLBACK');
        const posicao = await posicaoDe(pool, ativoHoje.rows[0].id);
        return res.status(409).json({
          erro: `A placa ${placa} já está na fila de hoje.`,
          ja_registrada: true,
          posicao,
          registrado_em: ativoHoje.rows[0].registrado_txt,
        });
      }

      if (emContingencia) {
        // Na contingência, bloqueia segunda entrada no mesmo dia se já finalizou
        const finalHoje = await client.query(`
          SELECT id FROM fila_motoristas
           WHERE placa = $1
             AND data_fila = $2::date
             AND status = 'finalizado'
           LIMIT 1
        `, [placa, rel.hoje]);

        if (finalHoje.rowCount) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            erro: 'Em contingência, quem carregou só pode marcar vez novamente a partir das 00h do dia seguinte.',
          });
        }

        // Se carregou ontem entre 06:00 e 23:59 e hoje ainda não virou 00:00 (caso janela estendida), bloqueia
        const finalOntem = await client.query(`
          SELECT id FROM fila_motoristas
           WHERE placa = $1
             AND data_fila = $2::date
             AND status = 'finalizado'
             AND extract(hour FROM registrado_em AT TIME ZONE $3)::int >= 6
           LIMIT 1
        `, [placa, rel.ontem, TZ]);

        if (finalOntem.rowCount && rel.hora >= 6) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            erro: 'Motorista que carregou após 06h só entra novamente a partir das 00h do dia seguinte.',
          });
        }
      } else {
        // Modo normal: bloqueia por FILA_BLOQUEIO_HORAS (padrão 1h) após virar 'finalizado'
        const bloqueio = await client.query(`
          SELECT to_char((status_alterado_em + make_interval(hours => $3)) AT TIME ZONE $4, 'HH24:MI') AS libera_hora
            FROM fila_motoristas
           WHERE placa = $1
             AND status = 'finalizado'
             AND status_alterado_em IS NOT NULL
             AND (status_alterado_em + make_interval(hours => $3)) > now()
           ORDER BY status_alterado_em DESC LIMIT 1
        `, [placa, rel.hoje, cfg.bloqueioHoras, TZ]);

        if (bloqueio.rowCount) {
          await client.query('ROLLBACK');
          return res.status(403).json({
            erro: `Carregamento finalizado recentemente. Nova entrada liberada a partir das ${bloqueio.rows[0].libera_hora}.`,
          });
        }
      }

      const ins = await client.query(
        `INSERT INTO fila_motoristas (data_fila, placa, nome, ip, user_agent, lat, lng, em_contingencia)
         VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, ${SQL_HORA} AS registrado_txt`,
        [
          rel.hoje,
          placa,
          nome,
          ipDe(req),
          String(req.headers['user-agent'] || '').slice(0, 300),
          lat,
          lng,
          emContingencia,
        ]
      );

      await client.query('COMMIT');
      const posicao = await posicaoDe(pool, ins.rows[0].id);
      res.json({
        ok: true,
        id: ins.rows[0].id,
        posicao,
        placa,
        nome,
        registrado_em: ins.rows[0].registrado_txt,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('fila registrar', e);
      res.status(500).json({ erro: 'Erro interno.' });
    } finally {
      client.release();
    }
  });

  // ---------- FATURISTA / OPERAÇÃO ----------

  router.get('/modo', exigirAdmin, async (req, res) => {
    try {
      await processarCicloContingencia();
      const rel = await infoRelogio();
      const m = await obterModo();
      res.json({
        modo: m.modo,
        alterado_em: m.alterado_em,
        alterado_por: m.alterado_por,
        pode_alterar: rel.hora >= 6 && rel.hora < 18,
      });
    } catch (e) {
      console.error('fila modo get', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  router.post('/modo', exigirAdmin, async (req, res) => {
    try {
      await processarCicloContingencia();
      const rel = await infoRelogio();
      const novoModo = String((req.body && req.body.modo) || '').trim().toLowerCase();
      const op = String((req.body && req.body.operador) || '').trim().slice(0, 60);

      if (rel.hora < 6 || rel.hora >= 18) {
        return res.status(403).json({
          erro: 'A chave de modo (Normal / Contingência) só pode ser alterada entre 06h e 18h.',
        });
      }
      if (novoModo !== 'normal' && novoModo !== 'contingencia') {
        return res.status(400).json({ erro: 'Modo inválido. Use normal ou contingencia.' });
      }
      if (!op) {
        return res.status(400).json({ erro: 'Informe o nome do operador.' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          UPDATE fila_config
             SET modo = $1,
                 alterado_em = now(),
                 alterado_por = $2
           WHERE id = 1
        `, [novoModo, op]);

        let afetadosAguardando = 0;
        if (novoModo === 'contingencia') {
          const upd = await client.query(`
            UPDATE fila_motoristas
               SET em_contingencia = true
             WHERE data_fila = $1::date
               AND status = 'aguardando'
          `, [rel.hoje]);
          afetadosAguardando = upd.rowCount || 0;
        }
        await client.query('COMMIT');
        res.json({ ok: true, modo: novoModo, afetados_aguardando: afetadosAguardando });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (e) {
      console.error('fila modo post', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  router.get('/lista', exigirAdmin, async (req, res) => {
    try {
      await processarCicloContingencia();
      const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : null;
      const { rows } = await pool.query(
        `SELECT row_number() OVER (ORDER BY ${SQL_ORDEM})::int AS posicao,
                id, placa, nome, status, motivo, em_contingencia, retido_de,
                (revalidado_em IS NOT NULL) AS revalidado,
                to_char(registrado_em AT TIME ZONE '${TZ}', 'HH24:MI:SS') AS hora,
                to_char(registrado_em AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS') AS registrado_txt,
                to_char(status_alterado_em AT TIME ZONE '${TZ}', 'HH24:MI:SS') AS alterado_hora,
                status_alterado_por
           FROM fila_motoristas
          WHERE data_fila = COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date)
          ORDER BY ${SQL_ORDEM}`,
        [data]
      );
      const d = await pool.query(
        `SELECT to_char(COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date), 'DD/MM/YYYY') AS data_txt,
                to_char(now() AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS') AS emitido_em`,
        [data]
      );
      const modoInfo = await obterModo();
      res.json({
        data: d.rows[0].data_txt,
        emitido_em: d.rows[0].emitido_em,
        modo: modoInfo.modo,
        total: rows.length,
        itens: rows,
      });
    } catch (e) {
      console.error('fila lista', e);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  router.post('/:id/status', exigirAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status, motivo, operador } = req.body || {};
    if (!Number.isInteger(id)) {
      return res.status(400).json({ erro: 'Registro inválido.' });
    }
    if (!STATUS_VALIDOS.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }
    const op = String(operador || '').trim().slice(0, 60);
    if (!op) {
      return res.status(400).json({ erro: 'Informe o nome do operador.' });
    }
    const mot = String(motivo || '').trim().slice(0, 300);
    if (STATUS_COM_MOTIVO.includes(status) && mot.length < 3) {
      return res.status(400).json({ erro: 'Informe o motivo.' });
    }

    const client = await pool.connect();
    try {
      await assegurarBanco();
      await client.query('BEGIN');
      const atual = await client.query(`SELECT status FROM fila_motoristas WHERE id = $1 FOR UPDATE`, [id]);
      if (!atual.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ erro: 'Não encontrado.' });
      }
      await client.query(
        `UPDATE fila_motoristas
            SET status = $2, motivo = $3, status_alterado_em = now(), status_alterado_por = $4
          WHERE id = $1`,
        [id, status, mot || null, op]
      );
      await client.query(
        `INSERT INTO fila_log (fila_id, status_anterior, status_novo, motivo, operador)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, atual.rows[0].status, status, mot || null, op]
      );
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('fila status', e);
      res.status(500).json({ erro: 'Erro interno.' });
    } finally {
      client.release();
    }
  });

  if (!cfg.monitorKey || !cfg.adminKey || !cfg.baseUrl) {
    console.warn('[fila] Defina FILA_MONITOR_KEY, FILA_ADMIN_KEY e FILA_BASE_URL.');
  }

  app.use('/api/fila', router);
};