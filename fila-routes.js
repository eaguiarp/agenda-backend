// fila-routes.js — Fila online de motoristas (AgendaCD)
// Uso no server.js (depois de criar `app` e `pool`):
//   require('./fila-routes')(app, pool);
//
// Variáveis de ambiente (Railway):
//   FILA_MONITOR_KEY  chave do monitor da portaria (obrigatória)
//   FILA_ADMIN_KEY    chave da faturista/operadores (obrigatória)
//   FILA_BASE_URL     ex.: https://seu-app.up.railway.app  (obrigatória)
//   FILA_HORA_INICIO  hora de abertura, padrão 0
//   FILA_HORA_FIM     hora de fechamento, padrão 18
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
  horaFim: parseInt(process.env.FILA_HORA_FIM || '18', 10),
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
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function distanciaM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function ipDe(req) {
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',').pop().trim() : req.socket.remoteAddress || '').slice(0, 64);
}

module.exports = function montarFila(app, pool) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const exigirMonitor = (req, res, next) =>
    igual(req.query.chave || req.headers['x-fila-chave'], cfg.monitorKey)
      ? next() : res.status(401).json({ erro: 'Chave do monitor inválida.' });

  const exigirAdmin = (req, res, next) =>
    igual(req.headers['x-fila-admin'], cfg.adminKey)
      ? next() : res.status(401).json({ erro: 'Chave de acesso inválida.' });

  router.get('/qr.png', exigirMonitor, async (req, res) => {
    const texto = req.query.texto;
    if (typeof texto !== 'string' || !texto || texto.length > 2048)
      return res.status(400).send('Parâmetro "texto" obrigatório (máximo de 2048 caracteres).');

    try {
      const bufferPng = await QRCode.toBuffer(texto, {
        errorCorrectionLevel: 'M',
        margin: 4,
        scale: 6
      });
      res.type('png').set('Cache-Control', 'no-store').send(bufferPng);
    } catch (e) {
      console.error('fila qr imagem', e);
      res.status(500).send('Erro ao gerar QR Code.');
    }
  });

  // Janela de funcionamento, sempre pela hora do servidor/banco (nunca do celular)
  async function janela() {
    const { rows } = await pool.query(
      `SELECT extract(hour FROM now() AT TIME ZONE $1)::int AS h`, [TZ]);
    const h = rows[0].h;
    return { aberta: h >= cfg.horaInicio && h < cfg.horaFim, hora: h };
  }
  const msgFechada = () =>
    `Fila online fechada. Funciona das ${String(cfg.horaInicio).padStart(2, '0')}h às ${String(cfg.horaFim).padStart(2, '0')}h.`;

  // ---------- MONITOR DA PORTARIA ----------

  // Gera um novo QR (token de uso único, validade curta)
  router.get('/qr-atual', exigirMonitor, async (req, res) => {
    try {
      const j = await janela();
      if (!j.aberta) return res.status(403).json({ fechada: true, erro: msgFechada() });
      const token = crypto.randomBytes(16).toString('hex');
      const { rows } = await pool.query(
        `INSERT INTO fila_tokens (token, expira_em)
         VALUES ($1, now() + make_interval(secs => $2))
         RETURNING token, extract(epoch FROM (expira_em - now()))*1000 AS restante_ms`,
        [token, cfg.tokenSeg]);
      if (Math.random() < 0.05)
        pool.query(`DELETE FROM fila_tokens WHERE criado_em < now() - interval '2 days'`).catch(() => {});
      res.json({
        token,
        url: `${cfg.baseUrl}/fila.html?k=${token}`,
        restante_ms: Math.round(rows[0].restante_ms),
      });
    } catch (e) { console.error('fila qr-atual', e); res.status(500).json({ erro: 'Erro interno.' }); }
  });

  // O monitor pergunta se o QR atual já foi usado (para trocar na hora)
  router.get('/qr-status', exigirMonitor, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT (usado_em IS NOT NULL) AS usado, (expira_em <= now()) AS expirado
         FROM fila_tokens WHERE token = $1`, [String(req.query.t || '')]);
      if (!rows.length) return res.json({ usado: true, expirado: true });
      res.json(rows[0]);
    } catch (e) { res.status(500).json({ erro: 'Erro interno.' }); }
  });

  // ---------- MOTORISTA ----------

  // POST (e não GET) para que pré-visualizadores de link não consumam o token
  router.post('/entrar', async (req, res) => {
    try {
      const k = String((req.body && req.body.k) || '');
      if (!/^[a-f0-9]{32}$/.test(k))
        return res.status(400).json({ erro: 'QR inválido. Escaneie o QR da portaria.' });
      const j = await janela();
      if (!j.aberta) return res.status(403).json({ erro: msgFechada() });

      const sessao = crypto.randomBytes(16).toString('hex');
      const r = await pool.query(
        `UPDATE fila_tokens
            SET usado_em = now(), sessao = $2, ip = $4,
                sessao_expira = now() + make_interval(secs => $3)
          WHERE token = $1 AND usado_em IS NULL AND expira_em > now()
          RETURNING extract(epoch FROM (sessao_expira - now())) AS restante_s`,
        [k, sessao, cfg.sessaoSeg, ipDe(req)]);
      if (!r.rowCount)
        return res.status(410).json({ erro: 'QR expirado ou já utilizado. Escaneie novamente o QR que está na portaria.' });
      res.json({ sessao, restante_s: Math.round(r.rows[0].restante_s), geo: cfg.geoAtiva });
    } catch (e) { console.error('fila entrar', e); res.status(500).json({ erro: 'Erro interno.' }); }
  });

  async function posicaoDe(client, id) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS pos
         FROM fila_motoristas f, (SELECT data_fila, registrado_em, id FROM fila_motoristas WHERE id = $1) m
        WHERE f.data_fila = m.data_fila AND (f.registrado_em, f.id) <= (m.registrado_em, m.id)`, [id]);
    return rows[0].pos;
  }

  const SQL_HORA = `to_char(registrado_em AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS')`;

  router.post('/registrar', async (req, res) => {
    const b = req.body || {};
    const placa = String(b.placa || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const nome = String(b.nome || '').trim().split(/\s+/)[0].slice(0, 40);
    const sessao = String(b.sessao || '');

    if (!RE_PLACA.test(placa)) return res.status(400).json({ erro: 'Placa inválida. Exemplos: ABC1234 ou ABC1D23.' });
    if (nome.length < 2 || !/^[\p{L}'-]+$/u.test(nome)) return res.status(400).json({ erro: 'Informe seu primeiro nome.' });
    if (!/^[a-f0-9]{32}$/.test(sessao)) return res.status(401).json({ erro: 'Sessão inválida. Escaneie o QR da portaria.' });

    let lat = null, lng = null;
    if (cfg.geoAtiva) {
      lat = parseFloat(b.lat); lng = parseFloat(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return res.status(400).json({ erro: 'Ative a localização do celular para registrar.' });
      if (distanciaM(cfg.geoLat, cfg.geoLng, lat, lng) > cfg.geoRaio)
        return res.status(403).json({ erro: 'Você precisa estar no pátio do CD para entrar na fila.' });
    } else if (Number.isFinite(parseFloat(b.lat)) && Number.isFinite(parseFloat(b.lng))) {
      lat = parseFloat(b.lat); lng = parseFloat(b.lng);
    }

    try {
      const j = await janela();
      if (!j.aberta) return res.status(403).json({ erro: msgFechada() });

      const lim = await pool.query(
        `SELECT count(*)::int AS n FROM fila_motoristas
          WHERE ip = $1 AND registrado_em > now() - interval '10 minutes'`, [ipDe(req)]);
      if (lim.rows[0].n >= cfg.maxPorIp10min)
        return res.status(429).json({ erro: 'Muitos registros deste aparelho. Procure a portaria.' });
    } catch (e) { return res.status(500).json({ erro: 'Erro interno.' }); }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // A sessão só vale uma vez. Se o INSERT falhar, o ROLLBACK devolve a sessão.
      const s = await client.query(
        `UPDATE fila_tokens SET sessao_usada_em = now()
          WHERE sessao = $1 AND sessao_usada_em IS NULL AND sessao_expira > now()
          RETURNING token`, [sessao]);
      if (!s.rowCount) {
        await client.query('ROLLBACK');
        return res.status(401).json({ erro: 'Sessão expirada. Escaneie novamente o QR da portaria.' });
      }
      const ins = await client.query(
        `INSERT INTO fila_motoristas (data_fila, placa, nome, ip, user_agent, lat, lng)
         VALUES ((now() AT TIME ZONE '${TZ}')::date, $1, $2, $3, $4, $5, $6)
         RETURNING id, ${SQL_HORA} AS registrado_txt`,
        [placa, nome, ipDe(req), String(req.headers['user-agent'] || '').slice(0, 300), lat, lng]);
      await client.query('COMMIT');
      const posicao = await posicaoDe(pool, ins.rows[0].id);
      res.json({ ok: true, posicao, placa, nome, registrado_em: ins.rows[0].registrado_txt });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      if (e.code === '23505') {
        try {
          const ex = await pool.query(
            `SELECT id, ${SQL_HORA} AS registrado_txt FROM fila_motoristas
              WHERE placa = $1 AND data_fila = (now() AT TIME ZONE '${TZ}')::date`, [placa]);
          if (ex.rowCount) {
            const posicao = await posicaoDe(pool, ex.rows[0].id);
            return res.status(409).json({
              erro: `A placa ${placa} já está na fila de hoje.`,
              ja_registrada: true, posicao, registrado_em: ex.rows[0].registrado_txt });
          }
        } catch (_) {}
        return res.status(409).json({ erro: `A placa ${placa} já está na fila de hoje.` });
      }
      console.error('fila registrar', e);
      res.status(500).json({ erro: 'Erro interno.' });
    } finally { client.release(); }
  });

  // ---------- FATURISTA / OPERAÇÃO ----------

  router.get('/lista', exigirAdmin, async (req, res) => {
    try {
      const data = /^\d{4}-\d{2}-\d{2}$/.test(req.query.data || '') ? req.query.data : null;
      const { rows } = await pool.query(
        `SELECT row_number() OVER (ORDER BY registrado_em, id)::int AS posicao,
                id, placa, nome, status, motivo,
                to_char(registrado_em AT TIME ZONE '${TZ}', 'HH24:MI:SS') AS hora,
                to_char(registrado_em AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS') AS registrado_txt,
                to_char(status_alterado_em AT TIME ZONE '${TZ}', 'HH24:MI:SS') AS alterado_hora,
                status_alterado_por
           FROM fila_motoristas
          WHERE data_fila = COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date)
          ORDER BY registrado_em, id`, [data]);
      const d = await pool.query(
        `SELECT to_char(COALESCE($1::date, (now() AT TIME ZONE '${TZ}')::date), 'DD/MM/YYYY') AS data_txt,
                to_char(now() AT TIME ZONE '${TZ}', 'DD/MM/YYYY HH24:MI:SS') AS emitido_em`, [data]);
      res.json({ data: d.rows[0].data_txt, emitido_em: d.rows[0].emitido_em, total: rows.length, itens: rows });
    } catch (e) { console.error('fila lista', e); res.status(500).json({ erro: 'Erro interno.' }); }
  });

  router.post('/:id/status', exigirAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status, motivo, operador } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ erro: 'Registro inválido.' });
    if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
    const op = String(operador || '').trim().slice(0, 60);
    if (!op) return res.status(400).json({ erro: 'Informe o nome do operador.' });
    const mot = String(motivo || '').trim().slice(0, 300);
    if (STATUS_COM_MOTIVO.includes(status) && mot.length < 3)
      return res.status(400).json({ erro: 'Informe o motivo.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const atual = await client.query(`SELECT status FROM fila_motoristas WHERE id = $1 FOR UPDATE`, [id]);
      if (!atual.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ erro: 'Não encontrado.' }); }
      await client.query(
        `UPDATE fila_motoristas
            SET status = $2, motivo = $3, status_alterado_em = now(), status_alterado_por = $4
          WHERE id = $1`, [id, status, mot || null, op]);
      await client.query(
        `INSERT INTO fila_log (fila_id, status_anterior, status_novo, motivo, operador)
         VALUES ($1, $2, $3, $4, $5)`, [id, atual.rows[0].status, status, mot || null, op]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('fila status', e);
      res.status(500).json({ erro: 'Erro interno.' });
    } finally { client.release(); }
  });

  if (!cfg.monitorKey || !cfg.adminKey || !cfg.baseUrl)
    console.warn('[fila] Defina FILA_MONITOR_KEY, FILA_ADMIN_KEY e FILA_BASE_URL.');

  app.use('/api/fila', router);
};
