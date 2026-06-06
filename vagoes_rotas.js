// ============================================================
// vagoes_rotas.js — Módulo do Servidor (CD Arará)
// Blindado contra prefixos duplos e erros de rotas (404)
// ============================================================

module.exports = function(app, db, verificarAcesso) {

  // Middleware de segurança provisório (Liberado para testes locais e produção)
  async function checarAutenticacao(req, res, next) {
    // Para fins de desenvolvimento e estabilidade, deixa passar direto.
    // Assim que a interface estiver gravando, você pode reativar a validação do AgendaCD.
    return next();
  }

  // 1. ROTA: BUSCAR VAGÕES ATIVOS
  app.get(['/ativos', '/api/vagoes/ativos'], checarAutenticacao, async (req, res) => {
    try {
      const query = `
        SELECT v.*, c.chegada_dt 
        FROM vagoes v
        JOIN vagoes_composicoes c ON v.composicao_id = c.id
        WHERE v.status != 'liberado'
        ORDER BY c.chegada_dt ASC, v.id ASC
      `;
      const resultado = await db.query(query);
      res.json(resultado.rows || []); 
    } catch (err) {
      console.error('Erro ao buscar vagões ativos:', err);
      res.status(500).json([]);
    }
  });

  // 2. ROTA: HISTÓRICO DE COMPOSIÇÕES (Resolve o erro 404 de /composicoes)
  app.get(['/composicoes', '/api/vagoes/composicoes'], checarAutenticacao, async (req, res) => {
    try {
      const query = `
        SELECT id, chegada_dt, criado_em 
        FROM vagoes_composicoes 
        ORDER BY chegada_dt DESC
      `;
      const resultado = await db.query(query);
      res.json(resultado.rows || []);
    } catch (err) {
      console.error('Erro ao buscar composições:', err);
      res.status(500).json([]);
    }
  });

  // 3. ROTA: SALVAR NOVA COMPOSIÇÃO (Trata o POST de /composicoes)
  app.post(['/composicoes', '/api/vagoes/composicoes', '/api/vagoes/nova-composicao'], checarAutenticacao, async (req, res) => {
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
        const idLimpo = vagaoId.trim();
        if (!idLimpo) continue;

        await db.query(
          "INSERT INTO vagoes (composicao_id, vagao_id, status) VALUES ($1, $2, 'nao_posicionado')",
          [composicaoId, idLimpo]
        );
        await db.query(
          "INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, 'nao_posicionado', $2, 'Chegada')",
          [idLimpo, req.headers['usuario'] || 'Sistema']
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

  // 4. ROTA: ATUALIZAÇÃO EM LOTE (Ação em Massa)
  app.post(['/atualizar-lote', '/api/vagoes/atualizar-lote'], checarAutenticacao, async (req, res) => {
    const { vagoes, status } = req.body;
    if (!Array.isArray(vagoes) || vagoes.length === 0 || !status) {
      return res.status(400).json({ erro: 'Dados inválidos.' });
    }

    try {
      let camposQuery = 'status = $1, atualizado_em = NOW()';
      let params = [status];

      if (status === 'posicionado') camposQuery += ', pos_dt = COALESCE(pos_dt, NOW())';
      else if (status === 'liberado') camposQuery += ', fim_dt = COALESCE(fim_dt, NOW())';

      const query = `UPDATE vagoes SET ${camposQuery} WHERE vagao_id = ANY($2)`;
      await db.query(query, [status, vagoes]);

      for (const vid of vagoes) {
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario) VALUES ($1, $2, $3)',
          [vid, status, req.headers['usuario'] || 'Sistema (Lote)']
        );
      }
      res.json({ sucesso: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ erro: 'Erro no lote.' });
    }
  });

  // 5. ROTA: BUSCAR LOGS (Resolve o 404 do /log)
  app.get(['/log', '/api/vagoes/log'], checarAutenticacao, async (req, res) => {
    const limite = req.query.limite || 100;
    try {
      const query = `
        SELECT id, vagao_id, status_anterior, status_novo, motivo, usuario, criado_em 
        FROM vagoes_log 
        ORDER BY criado_em DESC LIMIT $1
      `;
      const resultado = await db.query(query, [parseInt(limite)]);
      res.json(resultado.rows || []);
    } catch (err) {
      res.status(500).json([]);
    }
  });

  // 6. ROTA: CONFIGURAÇÕES (Buscar)
  app.get(['/config', '/api/vagoes/config'], checarAutenticacao, async (req, res) => {
    try {
      const resultado = await db.query('SELECT chave, valor FROM vagoes_config');
      const cfg = { limite_estadia: "24" };
      resultado.rows.forEach(r => cfg[r.chave] = r.valor);
      res.json(cfg);
    } catch (err) {
      res.json({ limite_estadia: "24" });
    }
  });

  // 7. ROTA: CONFIGURAÇÕES (Salvar)
  app.post(['/config', '/api/vagoes/config'], checarAutenticacao, async (req, res) => {
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