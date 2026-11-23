
const $ = id => document.getElementById(id);

let token = localStorage.getItem("dpawson_device_token") || "";

function msg(el, text, error = false) {
  el.innerHTML = text
    ? `<div class="message ${error ? "error" : ""}">${text}</div>`
    : "";
}

async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    ...(token ? { "x-device-token": token } : {})
  };

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw Error(data.error || "Request failed");
  }

  return data;
}

const fmt = time =>
  new Date(time).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  });

function formatDate(date) {
  const parts = String(date).slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : date;
}

function formatHours(minutes) {
  const total = Number(minutes) || 0;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// Display the employee's own overtime requests
async function loadOvertime() {
  const container = $("myOvertime");
  if (!container) return;

  try {
    const requests = await api("/api/employee/overtime");

    if (!requests.length) {
      container.textContent = "No overtime requests submitted yet.";
      return;
    }

    container.innerHTML = requests.map(r => {
      const status = String(r.status || "pending").toLowerCase();

      const colour = status === "approved"
        ? "#218447"
        : status === "rejected"
          ? "#c0392b"
          : "#a66a00";

      const label = status === "approved"
        ? "✓ Approved"
        : status === "rejected"
          ? "✕ Rejected"
          : "⏳ Pending";

      return `
        <div style="border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
            <strong>${escapeHtml(formatDate(r.work_date))}</strong>
            <span style="color:${colour};font-weight:bold;">${label}</span>
          </div>
          <div style="margin-top:8px;">
            ${escapeHtml(String(r.start_time).slice(0,5))}
            –
            ${escapeHtml(String(r.finish_time).slice(0,5))}
            <strong>(${formatHours(r.minutes)})</strong>
          </div>
          ${r.reason
            ? `<div class="muted" style="margin-top:5px;">Reason: ${escapeHtml(r.reason)}</div>`
            : ""}
        </div>
      `;
    }).join("");

  } catch (error) {
    container.textContent = "Could not load overtime requests.";
  }
}

// Load employee information
async function load() {
  if (!token) {
    $("pairCard").style.display = "block";
    $("appCard").style.display = "none";
    return;
  }

  try {
    const d = await api("/api/employee/me");

    $("pairCard").style.display = "none";
    $("appCard").style.display = "block";

    $("empName").textContent = d.employee.name;
    $("status").textContent = d.state;

    $("pendingCount").textContent = d.pendingOvertime
      ? `${d.pendingOvertime} overtime request(s) pending`
      : "";

    $("clockIn").disabled = d.state !== "off";
    $("clockOut").disabled = d.state === "off";
    $("breakStart").disabled = d.state !== "working";
    $("breakEnd").disabled = d.state !== "break";

    $("today").innerHTML = d.today.length
      ? d.today.map(x => `
          <div>
            ${escapeHtml(x.event_type.replaceAll("_", " "))}
            —
            <strong>${fmt(x.event_time)}</strong>
            ${x.source === "automatic" ? " (automatic)" : ""}
          </div>
        `).join("")
      : "No events yet today.";

    await loadOvertime();

  } catch (error) {
    // Only remove pairing if the device is no longer authorised.
    if (error.message === "This phone is not paired") {
      localStorage.removeItem("dpawson_device_token");
      token = "";
      $("pairCard").style.display = "block";
      $("appCard").style.display = "none";
    } else {
      msg($("eventMsg"), error.message, true);
    }
  }
}

// Pair employee phone
$("pairBtn").onclick = async () => {
  try {
    const d = await api("/api/employee/pair", {
      method: "POST",
      body: JSON.stringify({
        code: $("pairCode").value,
        deviceName: $("deviceName").value
      })
    });

    token = d.deviceToken;
    localStorage.setItem("dpawson_device_token", token);
    load();

  } catch (error) {
    msg($("pairMsg"), error.message, true);
  }
};

// Clocking and breaks
async function ev(type) {
  try {
    await api("/api/employee/event", {
      method: "POST",
      body: JSON.stringify({ type })
    });
    load();
  } catch (error) {
    msg($("eventMsg"), error.message, true);
  }
}

$("clockIn").onclick = () => ev("clock_in");
$("clockOut").onclick = () => ev("clock_out");
$("breakStart").onclick = () => ev("break_start");
$("breakEnd").onclick = () => ev("break_end");

// Default overtime date to today (UK)
$("otDate").value = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

// Submit overtime
$("otSubmit").onclick = async () => {
  const button = $("otSubmit");
  button.disabled = true;

  try {
    await api("/api/employee/overtime", {
      method: "POST",
      body: JSON.stringify({
        workDate: $("otDate").value,
        startTime: $("otStart").value,
        finishTime: $("otFinish").value,
        reason: $("otReason").value
      })
    });

    msg(
      $("otMsg"),
      "✅ Overtime request SENT successfully — awaiting manager approval."
    );

    button.textContent = "✓ Sent";

    await load();

    setTimeout(() => {
      button.textContent = "Submit for approval";
      button.disabled = false;
    }, 3000);

  } catch (error) {
    msg($("otMsg"), error.message, true);
    button.disabled = false;
  }
};

// Start the app
load();
