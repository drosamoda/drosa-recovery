# Mensagens + Conversas — migração React (27/09/2026)

Branch `feat/central-react`. Somente leitura; nenhum endpoint novo, nenhuma mudança de backend.

## Inventário
| Tela | Rota React | Endpoint (GET) | Filtros/paginação | Ações |
|---|---|---|---|---|
| Mensagens | `/messages` (aba Mensagens) | `/crm-api/messages` | `status`, `search`, `page`, `pageSize=25` | abrir detalhe |
| Detalhe de mensagem | drawer | `/crm-api/messages/:id` | — | nenhuma |
| Templates | `/messages` (aba Templates) | `/crm-api/templates` | sem paginação na API | nenhuma |
| Conversas | `/conversations` | `/crm-api/conversations` | `search`, `page` | abrir thread |
| Thread | painel lateral / tela cheia em mobile | `/crm-api/conversations/:id` | — | nenhuma (sem caixa de envio) |

## Contrato real (validado em produção, GET)
- `failureCategory` vem de `normalizeFailure()` no backend; frontend só traduz (mapa visual `FAILURE_CATEGORY`), código cru no tooltip.
- `metaStatus` de template é sempre `NOT_AVAILABLE` → exibido "Não disponível pela API"; aprovação Meta nunca inferida.
- Telefones chegam mascarados do backend.
- Observado: status `delivered/skipped/pending`; categorias `null/CONSENT_BLOCK/UNKNOWN_REASON`.

## Vocabulário
`sent` = "Disparada · aguardando entrega"; `skipped` = "Não disparada · bloqueada" (aviso, não erro); nunca "Enviada". Dashboard: "Enviadas no periodo" → "Disparadas no período".

## Componentes novos (genéricos)
`Pagination`, `Drawer`, `Notice`, `FilterBar/SelectFilter`, `QueryView` (loading/erro/vazio + 503 com código vira aviso neutro), `CodeBadge` (substitui MessageStatusBadge/SkipReasonBadge: mesmo componente com mapas diferentes), `Field`.

## Testes
12 novos (status, motivo desconhecido, filtros, paginação, detalhe, vazio, 401, payload inválido, templates, conversa lista/thread, 403). Estratégia de mocks registrada em `src/lib/__tests__/setup.ts` + `clearMocks: true`.

## Gaps
- Sem agregado de status por período nesta tela (dashboard cobre).
- Busca de templates por nome não existe na API (lista é pequena).
