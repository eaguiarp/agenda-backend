// ============================================================
// vagoes_rotas.js — Módulo do Servidor (CD Arará)
// Auth: JWT (8h) + rate limiting anti força-bruta
// ============================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET  = process.env.JWT_SECRET || 'arara_secret_troque_em_producao';
const JWT_EXPIRES = '8h';

// ── Rate Limiting (em memória) ───────────────────────────────
// Máx 5 tentativas por IP em 15 minutos; bloqueia por 15 min
const TENTATIVAS_MAX  = 5;
const JANELA_MS       = 15 * 60 * 1000; // 15 min
const BLOQUEIO_MS     = 15 * 60 * 1000; // 15 min
const loginTentativas = new Map(); // ip -> { count, primeiraEm, bloqueadoAte }

function checarRateLimit(ip) {
  const agora = Date.now();
  const reg   = loginTentativas.get(ip) || { count: 0, primeiraEm: agora, bloqueadoAte: 0 };

  if (reg.bloqueadoAte > agora) {
    const restam = Math.ceil((reg.bloqueadoAte - agora) / 60000);
    return { bloqueado: true, restam };
  }

  // Janela expirou — resetar
  if (agora - reg.primeiraEm > JANELA_MS) {
    loginTentativas.set(ip, { count: 0, primeiraEm: agora, bloqueadoAte: 0 });
    return { bloqueado: false };
  }

  return { bloqueado: false };
}

function registrarTentativaFalha(ip) {
  const agora = Date.now();
  const reg   = loginTentativas.get(ip) || { count: 0, primeiraEm: agora, bloqueadoAte: 0 };

  reg.count++;
  if (reg.count >= TENTATIVAS_MAX) {
    reg.bloqueadoAte = agora + BLOQUEIO_MS;
  }
  loginTentativas.set(ip, reg);
}

function registrarSucesso(ip) {
  loginTentativas.delete(ip);
}

// ── Middleware JWT ───────────────────────────────────────────
function autenticar(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Não autenticado.' });

  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

function autenticarAdmin(req, res, next) {
  autenticar(req, res, () => {
    if (req.usuario?.perfil !== 'admin') {
      return res.status(403).json({ erro: 'Acesso restrito a administradores.' });
    }
    next();
  });
}

// ── NÍVEL numérico (compatível com AgendaCD) ─────────────────
const NIVEL = { admin: 4, relatorio: 3, portaria: 2, operacao: 1 };

// ============================================================
module.exports = function(app, db, verificarAcesso) {

  // ── LOGIN ──────────────────────────────────────────────────
  app.post('/api/vagoes/login', async (req, res) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || 'unknown';

    const limite = checarRateLimit(ip);
    if (limite.bloqueado) {
      return res.status(429).json({
        erro: `Muitas tentativas. Aguarde ${limite.restam} minuto(s).`,
        bloqueado: true,
        restam: limite.restam
      });
    }

    const { usuario, senha } = req.body;
    if (!usuario || !senha) {
      return res.status(400).json({ erro: 'Usuário e senha obrigatórios.' });
    }

    try {
      const result = await db.query(
        'SELECT id, nome, perfil FROM usuarios WHERE nome = $1 AND senha = $2',
        [usuario.toLowerCase().trim(), senha]
      );

      if (!result.rows.length) {
        registrarTentativaFalha(ip);
        const reg = loginTentativas.get(ip) || { count: 1 };
        const restantes = TENTATIVAS_MAX - reg.count;
        return res.status(401).json({
          erro: restantes > 0
            ? `Usuário ou senha incorretos. ${restantes} tentativa(s) restante(s).`
            : 'Usuário ou senha incorretos.'
        });
      }

      registrarSucesso(ip);
      const user  = result.rows[0];
      const token = jwt.sign(
        { id: user.id, nome: user.nome, perfil: user.perfil },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      res.json({ token, nome: user.nome, perfil: user.perfil });
    } catch (err) {
      console.error('Erro no login:', err);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // ── VERIFICAR TOKEN (usado pelo front ao carregar) ─────────
  app.get('/api/vagoes/me', autenticar, (req, res) => {
    res.json({ nome: req.usuario.nome, perfil: req.usuario.perfil });
  });

  // ── CADASTRO DE USUÁRIO (admin only) ──────────────────────
  app.post('/api/vagoes/usuarios', autenticarAdmin, async (req, res) => {
    const { nome, senha, perfil } = req.body;
    if (!nome || !senha) return res.status(400).json({ erro: 'Nome e senha obrigatórios.' });
    const perfisValidos = ['operacao', 'portaria', 'relatorio', 'admin'];
    const perfilFinal   = perfisValidos.includes(perfil) ? perfil : 'operacao';
    try {
      const result = await db.query(
        'INSERT INTO usuarios (nome, senha, perfil) VALUES ($1, $2, $3) RETURNING id, nome, perfil',
        [nome.toLowerCase().trim(), senha, perfilFinal]
      );
      res.json(result.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ erro: 'Usuário já existe.' });
      res.status(500).json({ erro: 'Erro ao criar usuário.' });
    }
  });

  // ── LISTAR USUÁRIOS (admin only) ──────────────────────────
  app.get('/api/vagoes/usuarios', autenticarAdmin, async (req, res) => {
    try {
      const result = await db.query('SELECT id, nome, perfil, criado_em FROM usuarios ORDER BY nome');
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao buscar usuários.' });
    }
  });

  // ── EDITAR USUÁRIO (admin only) ───────────────────────────
  app.put('/api/vagoes/usuarios/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    const { senha, perfil } = req.body;
    const perfisValidos = ['operacao', 'portaria', 'relatorio', 'admin'];

    // Impede que o admin remova seu próprio perfil de admin
    if (String(req.usuario.id) === String(id) && perfil && perfil !== 'admin') {
      return res.status(400).json({ erro: 'Você não pode rebaixar sua própria conta.' });
    }

    const campos = [], valores = [];
    if (senha && senha.trim())  { campos.push(`senha  = $${campos.length + 1}`); valores.push(senha.trim()); }
    if (perfil && perfisValidos.includes(perfil)) {
      campos.push(`perfil = $${campos.length + 1}`); valores.push(perfil);
    }
    if (!campos.length) return res.status(400).json({ erro: 'Nada para atualizar.' });

    valores.push(id);
    try {
      await db.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${valores.length}`, valores);
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao atualizar usuário.' });
    }
  });

  // ── EXCLUIR USUÁRIO (admin only) ──────────────────────────
  app.delete('/api/vagoes/usuarios/:id', autenticarAdmin, async (req, res) => {
    const { id } = req.params;
    // Impede auto-exclusão
    if (String(req.usuario.id) === String(id)) {
      return res.status(400).json({ erro: 'Você não pode excluir sua própria conta.' });
    }
    try {
      await db.query('DELETE FROM usuarios WHERE id = $1', [id]);
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao excluir usuário.' });
    }
  });

  // 1. VAGÕES ATIVOS
  app.get(['/ativos', '/api/vagoes/ativos'], autenticar, async (req, res) => {
    try {
      const resultado = await db.query(`
        SELECT v.*, c.chegada_dt
        FROM vagoes v
        JOIN vagoes_composicoes c ON v.composicao_id = c.id
        WHERE v.status != 'devolvido'
        ORDER BY c.chegada_dt ASC, v.id ASC
      `);
      res.json(resultado.rows || []);
    } catch (err) {
      console.error('Erro ao buscar vagões ativos:', err);
      res.status(500).json([]);
    }
  });

  // 2. COMPOSIÇÕES
  app.get(['/composicoes', '/api/vagoes/composicoes'], autenticar, async (req, res) => {
    try {
      const resultado = await db.query(`
        SELECT id, chegada_dt, criado_em
        FROM vagoes_composicoes
        ORDER BY chegada_dt DESC
      `);
      res.json(resultado.rows || []);
    } catch (err) {
      console.error('Erro ao buscar composições:', err);
      res.status(500).json([]);
    }
  });

  // 3. NOVA COMPOSIÇÃO
  app.post(['/composicoes', '/api/vagoes/composicoes', '/api/vagoes/nova-composicao'], autenticar, async (req, res) => {
    const { chegadaDt, vagoes } = req.body;
    if (!chegadaDt || !Array.isArray(vagoes) || vagoes.length === 0) {
      return res.status(400).json({ erro: 'Dados incompletos.' });
    }
    try {
      await db.query('BEGIN');
      const compRes = await db.query(
        'INSERT INTO vagoes_composicoes (chegada_dt) VALUES ($1) RETURNING id',
        [chegadaDt]
      );
      const composicaoId = compRes.rows[0].id;
      for (const vagaoId of vagoes) {
        const idLimpo = vagaoId.replace(/\s+/g, '').toUpperCase();
        if (!idLimpo) continue;
        await db.query(
          "INSERT INTO vagoes (composicao_id, vagao_id, status) VALUES ($1, $2, 'nao_posicionado')",
          [composicaoId, idLimpo]
        );
        await db.query(
          "INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, 'nao_posicionado', $2, 'Chegada')",
          [idLimpo, req.usuario?.nome || 'Sistema']
        );
      }
      await db.query('COMMIT');
      res.json({ sucesso: true, composicaoId });
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Erro ao salvar composição:', err);
      res.status(500).json({ erro: 'Erro interno ao salvar.' });
    }
  });

  // 4. ATUALIZAR STATUS
  app.post(['/atualizar-lote', '/api/vagoes/atualizar-lote'], autenticar, async (req, res) => {
    const { vagoes, status, posDt, fimDt, motivo, nf } = req.body;
    if (!Array.isArray(vagoes) || vagoes.length === 0 || !status) {
      return res.status(400).json({ erro: 'Dados inválidos.' });
    }
    try {
      let camposQuery = 'status = $1, atualizado_em = NOW()';
      let params = [status];
      let idx = 2;

      if (posDt) { camposQuery += `, pos_dt = $${idx++}`; params.push(posDt); }
      else if (status === 'posicionado') { camposQuery += ', pos_dt = COALESCE(pos_dt, NOW())'; }

      if (fimDt) { camposQuery += `, fim_dt = $${idx++}`; params.push(fimDt); }
      else if (['liberado', 'vazio'].includes(status)) { camposQuery += ', fim_dt = COALESCE(fim_dt, NOW())'; }

      if (nf !== undefined && nf !== null) { camposQuery += `, nf = $${idx++}`; params.push(nf); }

      params.push(vagoes);
      await db.query(`UPDATE vagoes SET ${camposQuery} WHERE vagao_id = ANY($${idx})`, params);

      for (const vid of vagoes) {
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, $2, $3, $4)',
          [vid, status, req.usuario?.nome || 'Sistema', motivo || null]
        );
      }
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao atualizar lote:', err);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // 5. DEVOLUÇÃO MRS
  app.post(['/devolucao', '/api/vagoes/devolucao'], autenticar, async (req, res) => {
    const { vagaoIds } = req.body;
    if (!Array.isArray(vagaoIds) || vagaoIds.length === 0) {
      return res.status(400).json({ erro: 'Nenhum vagão informado.' });
    }
    try {
      await db.query(
        "UPDATE vagoes SET status = 'devolvido', atualizado_em = NOW() WHERE vagao_id = ANY($1)",
        [vagaoIds]
      );
      for (const vid of vagaoIds) {
        await db.query(
          "INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, 'devolvido', $2, 'Devolução MRS')",
          [vid, req.usuario?.nome || 'Sistema']
        );
      }
      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao registrar devolução:', err);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // 6. LOGS
  app.get(['/log', '/api/vagoes/log'], autenticar, async (req, res) => {
    const limite = parseInt(req.query.limite) || 100;
    try {
      const resultado = await db.query(`
        SELECT id, vagao_id, status_anterior, status_novo, motivo, usuario, criado_em
        FROM vagoes_log ORDER BY criado_em DESC LIMIT $1
      `, [limite]);
      res.json(resultado.rows || []);
    } catch (err) {
      res.status(500).json([]);
    }
  });

  // 7. CONFIG (buscar)
  app.get(['/config', '/api/vagoes/config'], autenticar, async (req, res) => {
    try {
      const resultado = await db.query('SELECT chave, valor FROM vagoes_config');
      const cfg = { limite_estadia: '24' };
      resultado.rows.forEach(r => cfg[r.chave] = r.valor);
      res.json(cfg);
    } catch (err) {
      res.json({ limite_estadia: '24' });
    }
  });

  // 8. CONFIG (salvar — admin only)
  app.post(['/config', '/api/vagoes/config'], autenticarAdmin, async (req, res) => {
    const { limite_estadia } = req.body;
    try {
      await db.query(
        "INSERT INTO vagoes_config (chave, valor) VALUES ('limite_estadia', $1) ON CONFLICT (chave) DO UPDATE SET valor = $1",
        [String(limite_estadia)]
      );
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao salvar.' });
    }
  });

};
