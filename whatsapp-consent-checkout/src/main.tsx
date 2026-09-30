import type { NubeApp } from "@tiendanube/nube-sdk-types";
import { handleCheckoutProgress, handleLocationChange } from "./consent";

/**
 * Extensão de checkout (NubeSDK) da D'Rosa Moda: captura opt-ins explícitos de
 * WhatsApp (atualizações do pedido e marketing). Ver README e o protocolo aceito
 * pelo backend.
 *
 * Nunca envia dados a nenhum endpoint HTTP próprio — a única gravação feita
 * é `order:add:extra`, despachada ao marcar a checkbox (ANTES de o pedido ser
 * concluído) e reconciliada no sucesso. O backend lê o resultado a partir do
 * pedido canônico obtido via webhook Nuvemshop autenticado (HMAC).
 *
 * Os handlers são idempotentes (deduplicação por estado da decisão): eventos
 * repetidos não geram loop de order:add:extra.
 */
export const App: NubeApp = (nube) => {
	nube.on("page:loaded", (state) => handleLocationChange(nube, state));
	nube.on("location:updated", (state) => handleLocationChange(nube, state));
	nube.on("checkout:ready", (state) => handleCheckoutProgress(nube, state));
	nube.on("order:update", (state) => handleCheckoutProgress(nube, state));
	nube.on("payment:update", (state) => handleCheckoutProgress(nube, state));
	nube.on("checkout:success", (state) => handleLocationChange(nube, state));
};
