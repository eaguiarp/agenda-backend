// ============================================================
// vagoes_rotas.js — Módulo de rotas do sistema de vagões
// Usar no server.js: require('./vagoes_rotas')(app, pool, verificarAcesso)
// ============================================================

module.exports = function registrarRotasVagoes(app, pool, verificarAcesso) {

  // ── MIDDLEWARE DE AUTH para vagões (reutiliza verificarAcesso do server.js) ──
  // Nível mínimo: operacao (1) para leitura/escrita, admin (4) para config
  async function authVagoes(req, res, next, nivelMinimo = 1) {
    const { usuario, senha } = req.headers;
    if (!usuario || !senha) return res.status(401).json({ erro: 'Credenciais ausentes' });
    const ok = await verificarAcesso(usuario, senha, nivelMinimo);
    if (!ok) return res.status(403).json({ erro: 'Acesso negado' });
    req.usuario = usuario;
    next();
  }

  const auth     = (req, res, next) => authVagoes(req, res, next, 1);
  const authAdmin = (req, res, next) => authVagoes(req, res, next, 4);

  // ============================================================
  // GET /api/vagoes/composicoes
  // Retorna todas as composições ativas com seus vagões
  // ============================================================
  app.get('/api/vagoes/composicoes', auth, async (req, res) => {
    try {
      // Composições que ainda têm ao menos 1 vagão não devolvido
      const comps = await pool.query(`
        SELECT c.id, c.chegada_dt
        FROM vagoes_composicoes c
        WHERE EXISTS (
          SELECT 1 FROM vagoes v
          WHERE v.composicao_id = c.id
            AND v.status IN ('nao_posicionado','posicionado','vazio','liberado')
        )
        ORDER BY c.chegada_dt ASC
      `);

      // Vagões de cada composição ativa
      const vagoes = await pool.query(`
        SELECT v.id, v.composicao_id, v.vagao_id, v.status,
               v.pos_dt, v.fim_dt, v.atualizado_em
        FROM vagoes v
        WHERE v.status IN ('nao_posicionado','posicionado','vazio','liberado')
        ORDER BY v.id ASC
      `);

      // Montar estrutura idêntica ao formato que o frontend já conhece
      const resultado = comps.rows.map(c => ({
        id:        c.id,
        chegadaDt: c.chegada_dt,
        vagoes: vagoes.rows
          .filter(v => v.composicao_id === c.id)
          .map(v => ({
            id:     v.vagao_id,
            status: v.status,
            posDt:  v.pos_dt   ? v.pos_dt.toISOString().slice(0,16)  : null,
            fimDt:  v.fim_dt   ? v.fim_dt.toISOString().slice(0,16)  : null,
            _dbId:  v.id       // ID interno do banco, usado para PATCH
          }))
      }));

      res.json(resultado);
    } catch (e) {
      console.error('[vagoes] GET composicoes:', e);
      res.status(500).json({ erro: 'Erro ao buscar composições' });
    }
  });

  // ============================================================
  // POST /api/vagoes/composicoes
  // Registra nova composição com lista de vagões
  // Body: { chegadaDt: "2025-06-05T08:30", vagoes: ["FLT001","FLT002"] }
  // ============================================================
  app.post('/api/vagoes/composicoes', auth, async (req, res) => {
    const { chegadaDt, vagoes } = req.body;
    if (!chegadaDt || !Array.isArray(vagoes) || vagoes.length === 0)
      return res.status(400).json({ erro: 'chegadaDt e vagoes[] são obrigatórios' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const compResult = await client.query(
        'INSERT INTO vagoes_composicoes (chegada_dt) VALUES ($1) RETURNING id',
        [chegadaDt]
      );
      const composicaoId = compResult.rows[0].id;

      for (const vId of vagoes) {
        await client.query(
          `INSERT INTO vagoes (composicao_id, vagao_id, status)
           VALUES ($1, $2, 'nao_posicionado')`,
          [composicaoId, vId.trim().toUpperCase()]
        );
        await client.query(
          `INSERT INTO vagoes_log (vagao_id, status_anterior, status_novo, motivo, usuario)
           VALUES ($1, NULL, 'nao_posicionado', 'Chegada registrada', $2)`,
          [vId.trim().toUpperCase(), req.usuario]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ id: composicaoId, total: vagoes.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[vagoes] POST composicoes:', e);
      res.status(500).json({ erro: 'Erro ao registrar composição' });
    } finally {
      client.release();
    }
  });

  // ============================================================
  // PATCH /api/vagoes/:dbId/status
  // Atualiza status de um vagão específico
  // Body: { status, posDt?, fimDt?, motivo? }
  // ============================================================
  app.patch('/api/vagoes/:dbId/status', auth, async (req, res) => {
    const { dbId } = req.params;
    const { status, posDt, fimDt, motivo } = req.body;

    const statusValidos = ['nao_posicionado','posicionado','vazio','liberado'];
    if (!statusValidos.includes(status))
      return res.status(400).json({ erro: 'Status inválido' });

    try {
      // Busca status atual para o log
      const atual = await pool.query(
        'SELECT vagao_id, status FROM vagoes WHERE id = $1',
        [dbId]
      );
      if (!atual.rows.length) return res.status(404).json({ erro: 'Vagão não encontrado' });

      const { vagao_id, status: statusAnt } = atual.rows[0];

      await pool.query(
        `UPDATE vagoes
         SET status = $1, pos_dt = $2, fim_dt = $3, atualizado_em = NOW()
         WHERE id = $4`,
        [status, posDt || null, fimDt || null, dbId]
      );

      await pool.query(
        `INSERT INTO vagoes_log (vagao_id, status_anterior, status_novo, motivo, usuario)
         VALUES ($1, $2, $3, $4, $5)`,
        [vagao_id, statusAnt, status, motivo || null, req.usuario]
      );

      res.json({ ok: true });
    } catch (e) {
      console.error('[vagoes] PATCH status:', e);
      res.status(500).json({ erro: 'Erro ao atualizar status' });
    }
  });

  // ============================================================
  // POST /api/vagoes/devolucao
  // Remove vagões devolvidos à MRS (apaga do pátio, registra no log)
  // Body: { vagaoIds: ["FLT001","FLT002"] }  ← IDs dos _dbId
  // ============================================================
  app.post('/api/vagoes/devolucao', auth, async (req, res) => {
    const { vagaoDbIds } = req.body; // array de IDs internos do banco
    if (!Array.isArray(vagaoDbIds) || vagaoDbIds.length === 0)
      return res.status(400).json({ erro: 'vagaoDbIds[] é obrigatório' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const dbId of vagaoDbIds) {
        const v = await client.query(
          'SELECT vagao_id FROM vagoes WHERE id = $1', [dbId]
        );
        if (!v.rows.length) continue;

        await client.query(
          `INSERT INTO vagoes_log (vagao_id, status_anterior, status_novo, motivo, usuario)
           VALUES ($1, 'liberado', 'devolvido', 'Devolução MRS confirmada', $2)`,
          [v.rows[0].vagao_id, req.usuario]
        );
        await client.query('DELETE FROM vagoes WHERE id = $1', [dbId]);
      }

      // Limpar composições que ficaram sem vagões
      await client.query(`
        DELETE FROM vagoes_composicoes
        WHERE id NOT IN (SELECT DISTINCT composicao_id FROM vagoes)
      `);

      await client.query('COMMIT');
      res.json({ ok: true, removidos: vagaoDbIds.length });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[vagoes] POST devolucao:', e);
      res.status(500).json({ erro: 'Erro ao confirmar devolução' });
    } finally {
      client.release();
    }
  });

  // ============================================================
  // GET /api/vagoes/log?limite=100&vagao=FLT001
  // Histórico de movimentações (auditoria)
  // ============================================================
  app.get('/api/vagoes/log', auth, async (req, res) => {
    const limite = Math.min(parseInt(req.query.limite) || 200, 500);
    const vagaoFiltro = req.query.vagao ? req.query.vagao.toUpperCase() : null;

    try {
      const params = vagaoFiltro ? [vagaoFiltro, limite] : [limite];
      const whereClause = vagaoFiltro ? 'WHERE vagao_id = $1' : '';
      const limiteParam = vagaoFiltro ? '$2' : '$1';

      const result = await pool.query(
        `SELECT id, vagao_id, status_anterior, status_novo, motivo, usuario, criado_em
         FROM vagoes_log
         ${whereClause}
         ORDER BY criado_em DESC
         LIMIT ${limiteParam}`,
        params
      );
      res.json(result.rows);
    } catch (e) {
      console.error('[vagoes] GET log:', e);
      res.status(500).json({ erro: 'Erro ao buscar log' });
    }
  });

  // ============================================================
  // GET /api/vagoes/config
  // PATCH /api/vagoes/config
  // Configurações do sistema (limite de estadia etc.)
  // Requer nível admin
  // ============================================================
  app.get('/api/vagoes/config', auth, async (req, res) => {
    try {
      const r = await pool.query(
        "SELECT valor FROM vagoes_config WHERE chave = 'limite_estadia'"
      );
      res.json({ limite_estadia: r.rows.length ? parseInt(r.rows[0].valor) : 24 });
    } catch {
      res.json({ limite_estadia: 24 });
    }
  });

  app.patch('/api/vagoes/config', authAdmin, async (req, res) => {
    const { limite_estadia } = req.body;
    if (!limite_estadia || isNaN(limite_estadia))
      return res.status(400).json({ erro: 'limite_estadia inválido' });
    try {
      await pool.query(`
        INSERT INTO vagoes_config (chave, valor) VALUES ('limite_estadia', $1)
        ON CONFLICT (chave) DO UPDATE SET valor = $1
      `, [String(limite_estadia)]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[vagoes] PATCH config:', e);
      res.status(500).json({ erro: 'Erro ao salvar config' });
    }
  });

  console.log('[vagoes] Rotas registradas em /api/vagoes/*');
};

// ROTA PARA ATUALIZAÇÃO EM LOTE (MÚLTIPLOS VAGÕES)
router.post('/atualizar-lote', async (req, res) => {
  const { vagoes, status } = req.body; // vagoes = ['FLT1', 'FLT2', ...]
  
  if (!Array.isArray(vagoes) || vagoes.length === 0 || !status) {
    return res.status(400).json({ erro: 'Dados inválidos para atualização em lote.' });
  }

  try {
    // Define os campos de tempo baseado no status operacional recebido
    let camposQuery = 'status = $1, atualizado_em = NOW()';
    let params = [status];

    if (status === 'posicionado') {
      camposQuery += ', pos_dt = COALESCE(pos_dt, NOW())';
    } else if (status === 'liberado') {
      camposQuery += ', fim_dt = COALESCE(fim_dt, NOW())';
    }

    // Executa o update em massa usando o operador SQL IN
    const query = `
      UPDATE vagoes 
      SET ${camposQuery}
      WHERE vagao_id = ANY($${params.length + 1})
    `;
    
    params.push(vagoes); // Adiciona o array de IDs para o ANY() do Postgres

    await db.query(query, params);

    // Opcional: Adiciona registros na tabela vagoes_log para auditoria
    for (const vid of vagoes) {
      await db.query(
        'INSERT INTO vagoes_log (vagao_id, status_novo, usuario) VALUES ($1, $2, $3)',
        [vid, status, req.headers['usuario'] || 'Sistema (Lote)']
      );
    }

    res.json({ sucesso: true });
  } catch (err) {
    console.error('Erro no update em lote:', err);
    res.status(500).json({ erro: 'Erro interno ao processar lote.' });
  }
});
