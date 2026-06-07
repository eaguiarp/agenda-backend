// ============================================================
// vagoes_rotas.js — Módulo do Servidor (CD Arará)
// ============================================================

module.exports = function(app, db, verificarAcesso) {

  async function checarAutenticacao(req, res, next) {
    return next(); // Reativar validação após estabilizar a interface
  }

  // 1. VAGÕES ATIVOS
  app.get(['/ativos', '/api/vagoes/ativos'], checarAutenticacao, async (req, res) => {
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
  app.get(['/composicoes', '/api/vagoes/composicoes'], checarAutenticacao, async (req, res) => {
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
        const idLimpo = vagaoId.replace(/\s+/g, '').toUpperCase();
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

  // 4. ATUALIZAR STATUS (individual ou lote — mesma rota)
  app.post(['/atualizar-lote', '/api/vagoes/atualizar-lote'], checarAutenticacao, async (req, res) => {
    const { vagoes, status, posDt, fimDt, motivo } = req.body;
    if (!Array.isArray(vagoes) || vagoes.length === 0 || !status) {
      return res.status(400).json({ erro: 'Dados inválidos.' });
    }

    try {
      // Monta query dinâmica para campos opcionais
      let camposQuery = 'status = $1, atualizado_em = NOW()';
      let params = [status];
      let idx = 2;

      if (posDt) {
        camposQuery += `, pos_dt = $${idx++}`;
        params.push(posDt);
      } else if (status === 'posicionado') {
        camposQuery += ', pos_dt = COALESCE(pos_dt, NOW())';
      }

      if (fimDt) {
        camposQuery += `, fim_dt = $${idx++}`;
        params.push(fimDt);
      } else if (['liberado', 'vazio'].includes(status)) {
        camposQuery += ', fim_dt = COALESCE(fim_dt, NOW())';
      }

      params.push(vagoes);
      await db.query(
        `UPDATE vagoes SET ${camposQuery} WHERE vagao_id = ANY($${idx})`,
        params
      );

      // Log de cada vagão
      for (const vid of vagoes) {
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, $2, $3, $4)',
          [vid, status, req.headers['usuario'] || 'Sistema', motivo || null]
        );
      }

      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao atualizar lote:', err);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // 5. DEVOLUÇÃO MRS (remove vagões do pátio)
  app.post(['/devolucao', '/api/vagoes/devolucao'], checarAutenticacao, async (req, res) => {
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
          [vid, req.headers['usuario'] || 'Sistema']
        );
      }

      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao registrar devolução:', err);
      res.status(500).json({ erro: 'Erro interno.' });
    }
  });

  // 6. LOGS
  app.get(['/log', '/api/vagoes/log'], checarAutenticacao, async (req, res) => {
    const limite = parseInt(req.query.limite) || 100;
    try {
      const resultado = await db.query(`
        SELECT id, vagao_id, status_anterior, status_novo, motivo, usuario, criado_em
        FROM vagoes_log
        ORDER BY criado_em DESC LIMIT $1
      `, [limite]);
      res.json(resultado.rows || []);
    } catch (err) {
      res.status(500).json([]);
    }
  });

  // 7. CONFIGURAÇÕES (buscar)
  app.get(['/config', '/api/vagoes/config'], checarAutenticacao, async (req, res) => {
    try {
      const resultado = await db.query('SELECT chave, valor FROM vagoes_config');
      const cfg = { limite_estadia: '24' };
      resultado.rows.forEach(r => cfg[r.chave] = r.valor);
      res.json(cfg);
    } catch (err) {
      res.json({ limite_estadia: '24' });
    }
  });

  // 8. CONFIGURAÇÕES (salvar)
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
