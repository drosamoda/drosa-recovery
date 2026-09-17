import type { NubeApp } from "@tiendanube/nube-sdk-types";
import { handleLocationChange } from "./consent";

/**
 * Extensão de checkout (NubeSDK) da D'Rosa Moda: captura opt-in explícito
 * para marketing via WhatsApp. Ver DROSA_CRM_HANDOFF_CLAUDE.md na raiz do
 * monorepo para a arquitetura completa e o protocolo aceito pelo backend.
 *
 * Nunca envia dados a nenhum endpoint HTTP próprio — a única gravação feita
 * é `order:add:extra`, lida depois pelo backend a partir do pedido canônico
 * obtido via webhook Nuvemshop autenticado (HMAC).
 */
export const App: NubeApp = (nube) => {
	nube.on("page:loaded", (state) => handleLocationChange(nube, state));
	nube.on("location:updated", (state) => handleLocationChange(nube, state));
};
