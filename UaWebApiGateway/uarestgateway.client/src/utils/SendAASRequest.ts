import { IRequestMessage } from "../service/IRequestMessage";
import { HandleFactory } from "../service/HandleFactory";
import { SessionContext } from "../SessionContext";

/**
 * Sends an AAS API request over the active WebSocket session when connected,
 * falling back to a direct REST call when the WebSocket is unavailable.
 *
 * @param session  - The current session context providing transport and state.
 * @param method   - HTTP method to use.
 * @param path     - AAS API path relative to /api/v3.0 (e.g. "/shells").
 * @param body     - Optional request body for POST/PUT requests.
 * @returns        The parsed response body typed as T.
 */
export async function sendAASRequest<T = any>(
    session: React.ContextType<typeof SessionContext>,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: any
): Promise<T> {
    const requestHandle = HandleFactory.increment();

    // Set a default WebSocket URL derived from the current host if none is configured.
    const defaultAASServerUrl = `ws://${location.host}/stream`;
    if (!session.serverUrl && session.setServerUrl) {
        console.log(`[AAS] Setting default WebSocket URL: ${defaultAASServerUrl}`);
        session.setServerUrl(defaultAASServerUrl);
    }

    const message: IRequestMessage = {
        ServiceId: "AASRequest",
        Body: {
            RequestHeader: { AASRequestHandle: requestHandle },
            Method: method,
            Path: path,
            Body: body,
        },
    };

    if (session.isConnected && typeof session.sendRequest === "function") {
        // Listener is registered before sending to avoid a race condition where
        // the response could arrive before the handler is attached.
        return new Promise<T>((resolve, reject) => {
            session.addAASResponseListener?.(requestHandle, (response) => {
                const result = response.Body?.Result;
                if (result !== undefined) {
                    resolve(result as T);
                } else {
                    reject(new Error("AAS response missing result"));
                }
            });

            console.log(`[AAS] WS sending: ${method} ${path}`);
            session.sendRequest(message, requestHandle);
        });
    }

    // WebSocket not available — fall back to direct REST.
    console.log(`[AAS] REST fallback: ${method} ${path}`);
    const res = await fetch(`/api/v3.0${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
}