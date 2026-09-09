import { requestLoginFirstCustomerHintCheck } from "./loginFirstCustomerHint";

export function queueTransactionAlert(accessToken, payload) {
  requestLoginFirstCustomerHintCheck();
  if (!accessToken || !payload?.transactionType) return;

  fetch("/api/transaction-alert", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}
