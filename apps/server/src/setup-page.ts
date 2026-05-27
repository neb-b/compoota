function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function setupPageHtml(publicBaseUrl: string | null): string {
  const publicUrlHtml = publicBaseUrl
    ? `<p class="muted">Public URL: <code>${escapeHtml(publicBaseUrl)}</code></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>compoota setup</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f6f7f9; color: #14171f; }
      main { max-width: 760px; margin: 0 auto; padding: 32px 20px; }
      h1 { margin: 0 0 8px; font-size: 32px; }
      p { color: #5c6472; }
      section { background: white; border: 1px solid #dde1e8; border-radius: 8px; padding: 18px; margin-top: 16px; }
      label { display: block; font-weight: 650; margin-bottom: 8px; }
      input { width: 100%; box-sizing: border-box; border: 1px solid #cbd2de; border-radius: 6px; padding: 11px 12px; font: inherit; }
      button { border: 0; border-radius: 6px; background: #1d4ed8; color: white; padding: 10px 14px; font: inherit; font-weight: 700; cursor: pointer; }
      button.secondary { background: #4b5563; }
      button.danger { background: #b91c1c; }
      .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .code { font-size: 28px; font-weight: 800; letter-spacing: 4px; }
      .muted { color: #687184; font-size: 14px; }
      code { background: #eef1f6; border-radius: 4px; padding: 2px 5px; }
      .device { display: flex; justify-content: space-between; gap: 12px; padding: 12px 0; border-top: 1px solid #edf0f4; }
      .error { color: #b91c1c; }
      @media (prefers-color-scheme: dark) {
        body { background: #101218; color: #f3f5f9; }
        section { background: #191d26; border-color: #303747; }
        input { background: #101218; border-color: #3c4558; color: #f3f5f9; }
        code { background: #252b38; }
        p, .muted { color: #aeb7c8; }
        .device { border-color: #2b3242; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>compoota setup</h1>
      <p>Create pairing codes and manage registered devices on your LAN.</p>
      ${publicUrlHtml}

      <section>
        <label for="secret">Setup secret</label>
        <input id="secret" type="password" autocomplete="current-password" placeholder="HOUSE_SETUP_SECRET" />
      </section>

      <section>
        <div class="row">
          <button id="create">Create pairing code</button>
          <button class="secondary" id="refresh">Refresh status</button>
        </div>
        <p id="pairing" class="muted"></p>
        <p id="error" class="error"></p>
      </section>

      <section>
        <h2>Devices</h2>
        <div id="devices" class="muted">No devices loaded.</div>
      </section>
      <section>
        <h2>Household status</h2>
        <div id="status" class="muted">No status loaded.</div>
      </section>
    </main>
    <script>
      const secret = document.getElementById("secret");
      const pairing = document.getElementById("pairing");
      const error = document.getElementById("error");
      const devices = document.getElementById("devices");
      const status = document.getElementById("status");

      function headers() {
        return { "Authorization": "Bearer " + secret.value, "Content-Type": "application/json" };
      }

      async function request(path, options = {}) {
        error.textContent = "";
        const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
        if (!response.ok) {
          throw new Error("Request failed: " + response.status);
        }
        return response.json();
      }

      async function createPairingCode() {
        try {
          const data = await request("/setup/pairing-code", { method: "POST", body: "{}" });
          pairing.innerHTML = '<span class="code">' + data.pairingCode + '</span><br />Expires at ' + new Date(data.expiresAt).toLocaleString();
          await loadDevices();
        } catch (err) {
          error.textContent = err.message;
        }
      }

      async function revokeDevice(id) {
        try {
          await request("/devices/" + encodeURIComponent(id) + "/revoke", { method: "POST", body: "{}" });
          await loadDevices();
        } catch (err) {
          error.textContent = err.message;
        }
      }

      async function loadDevices() {
        try {
          const data = await request("/devices");
          if (!data.length) {
            devices.textContent = "No devices registered yet.";
            await loadStatus();
            return;
          }
          devices.innerHTML = "";
          for (const device of data) {
            const row = document.createElement("div");
            row.className = "device";
            row.innerHTML = '<div><strong></strong><div class="muted"></div></div>';
            row.querySelector("strong").textContent = device.name;
            row.querySelector(".muted").textContent = device.id + " | " + (device.revokedAt ? "revoked" : "active");
            if (!device.revokedAt) {
              const button = document.createElement("button");
              button.className = "danger";
              button.textContent = "Revoke";
              button.onclick = () => revokeDevice(device.id);
              row.appendChild(button);
            }
            devices.appendChild(row);
          }
          await loadStatus();
        } catch (err) {
          error.textContent = err.message;
        }
      }

      async function loadStatus() {
        try {
          const data = await request("/setup/feed/status");
          const pendingReminders = (data.reminders || []).filter((item) => item.status === "pending").length;
          const failedDeliveries = (data.deliveries || []).filter((item) => item.status === "failed" || item.error_message).length;
          status.innerHTML = "";
          const lines = [
            "Events shown: " + (data.items || []).length,
            "Recent refresh runs: " + (data.runs || []).length,
            "Pending reminders: " + pendingReminders,
            "Recent delivery failures: " + failedDeliveries
          ];
          for (const line of lines) {
            const div = document.createElement("div");
            div.textContent = line;
            status.appendChild(div);
          }
        } catch (err) {
          error.textContent = err.message;
        }
      }

      document.getElementById("create").onclick = createPairingCode;
      document.getElementById("refresh").onclick = loadDevices;
    </script>
  </body>
</html>`;
}
