# PREVIEW_REGRESSION_MATRIX — `/crm-v2` (produção) × `/crm-next` (preview)

Uso na Fase I, assim que `drosa-central-preview` existir. Mesmo instante de coleta nos dois lados (≤5 min), só GET. Célula = PASS / FAIL / N/A + nota. Divergência numérica só é FAIL se não houver explicação documentada (ex.: vocabulário novo, amostra rotulada).

## Critérios por coluna
| Coluna | Como medir | PASS quando |
|---|---|---|
| Dados | mesmos filtros/página nos dois lados; comparar contagens e 5 registros-âncora (id) | mesmos ids/valores; diferenças só semânticas e documentadas |
| Filtros | aplicar cada filtro disponível nos dois | mesmo recorte (mesmo `total` da API) |
| Paginação | página 1, 2 e última | mesmos ids por página; total igual |
| Masking | telefone/e-mail em lista e detalhe | nunca completo em nenhum lado; React ⊆ v2 |
| Auth | sem credencial; segredo legado; sessão; sessão expirada; logout | 401 correto; legado funciona; sessão funciona; logout invalida |
| Responsividade | 375 / 768 / 1024 / 1440 | sem overflow horizontal da página; ações visíveis |
| Errors | forçar 401 e endpoint 5xx (id inexistente) | estado de erro explícito, sem tela branca |
| Loading | throttling 3G no DevTools | indicador de carregamento; sem layout quebrado |
| Latency | tempo até conteúdo útil (3 medições) | React ≤ v2 + 1s (mesma API) |
| Console | DevTools console | 0 erros (warnings documentados) |
| Network | DevTools network | só GET em `/crm-api/*` e `/central-auth/*`; 0 chamadas de escrita; nenhum segredo em URL |

## Matriz
| Tela | Dados | Filtros | Paginação | Masking | Auth | Responsivo | Errors | Loading | Latency | Console | Network | Notas esperadas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Dashboard | | N/A (período) | N/A | | | | | | | | | "Disparadas no período" (era "Enviadas") |
| Cliente 360 | | busca | | | | | | | | | | e-mail por cliente = NOT_AVAILABLE_FROM_CURRENT_API |
| Jornada | | 5 filtros | | | | | | | | | | não existe no v2 → comparar contra API direta |
| Mensagens | | status, busca | | | | | | | | | | vocabulário novo (Disparada/Não disparada) |
| Templates | | N/A | N/A | N/A | | | | | | | | status Meta "Não disponível pela API" |
| Conversas | | busca | | | | | | | | | | React é somente leitura (sem envio) |
| Recovery | | status carrinho | | | | | | | | | | funil = amostra da página; "Pedidos com contato registrado" |
| Campanhas & IA | | canal | N/A | | | | | | | | | título contraditório → DATA_QUALITY_WARNING; ai/opportunities ~5,6s (PERFORMANCE_DEBT) |
| E-mail | | N/A | N/A | | | | | | | | | sem abertura/clique (API não expõe) |
| Saúde | | N/A | N/A | N/A | | | | | | | | flags neutras; "Últimos N eventos" |
| Auditoria | | N/A | | | | | | | | | | log de operador NOT_AVAILABLE |
| BI | vs. BI Vercel | período 7/30/90 | N/A | N/A | | | | | | | | taxas sobre Disparadas (BI antigo usava total); 3 warnings de dados; embeds 3/5/6/7/8 dependem de habilitar embedding |

## Checks transversais do preview (antes da matriz)
- `/jobs/*`, `/webhooks/*`, `/admin/*`, `/inbox/*` → 404.
- Log de boot: `[cron] jobs internos desabilitados`.
- Negative tests do role reader executados pela própria revisão: INSERT/UPDATE/DELETE/CREATE/TEMP negados.
- `X-Forwarded-For` real confirma `CENTRAL_TRUSTED_PROXY_HOPS=1`.
- Cookie `central_session` com `Secure; HttpOnly; SameSite=Strict`.
