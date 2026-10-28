const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PLAN_OPTIONS = ["Semestral", "Trimestral", "Mensal", "Casal"];
const SCHEMAS = {
  usuarios: {
    title: "Usuários", singular: "usuário", description: "Gerencie os acessos ao painel da academia.",
    fields: [
      { key: "nome", label: "Nome completo", required: true },
      { key: "email", label: "E-mail", type: "email", required: true },
      { key: "perfil", label: "Perfil de acesso", type: "select", options: ["Administrador", "Recepção", "Financeiro"] },
      { key: "telefone", label: "Telefone", type: "tel" }
    ],
    columns: [["nome", "Nome"], ["email", "E-mail"], ["perfil", "Perfil"], ["telefone", "Telefone"]]
  },
  clientes: {
    title: "Clientes", singular: "cliente", description: "Cadastre alunos, acompanhe seus planos e mantenha os contatos atualizados.",
    fields: [
      { key: "nome", label: "Nome completo", required: true },
      { key: "telefone", label: "Telefone", type: "tel", required: true },
      { key: "email", label: "E-mail", type: "email" },
      { key: "nascimento", label: "Data de nascimento", type: "date" },
      { key: "plano", label: "Plano", type: "select", options: PLAN_OPTIONS },
      { key: "vencimento", label: "Vencimento da mensalidade", type: "date" },
      { key: "status", label: "Status", type: "select", options: ["Ativo", "Inativo"] }
    ],
    columns: [["nome", "Nome"], ["telefone", "Telefone"], ["plano", "Plano"], ["vencimento", "Vencimento"], ["status", "Status"]]
  },
  funcionarios: {
    title: "Funcionários", singular: "funcionário", description: "Organize os dados da equipe e suas funções na academia.",
    fields: [
      { key: "nome", label: "Nome completo", required: true },
      { key: "cargo", label: "Cargo / função", required: true },
      { key: "telefone", label: "Telefone", type: "tel" },
      { key: "email", label: "E-mail", type: "email" },
      { key: "admissao", label: "Data de admissão", type: "date" }
    ],
    columns: [["nome", "Nome"], ["cargo", "Cargo"], ["telefone", "Telefone"], ["email", "E-mail"], ["admissao", "Admissão"]]
  },
  parcerias: {
    title: "Parcerias", singular: "parceria", description: "Cadastre empresas parceiras e a imagem que será exibida no site público.",
    fields: [
      { key: "nome", label: "Nome da empresa", required: true },
      { key: "descricao", label: "Descrição", full: true },
      { key: "imagem", label: "Imagem ou logotipo (JPEG, PNG, WebP ou GIF · até 700 KB)", type: "file", image: true, required: true }
    ],
    columns: [["imagem", "Logo"], ["nome", "Empresa"], ["descricao", "Descrição"]]
  },
  financas: {
    title: "Finanças", singular: "lançamento", description: "Registre entradas e despesas para acompanhar o movimento financeiro.",
    fields: [
      { key: "descricao", label: "Descrição", required: true },
      { key: "tipo", label: "Tipo", type: "select", options: ["Receita", "Despesa"] },
      { key: "categoria", label: "Categoria", type: "select", options: ["Mensalidade", "Matrícula", "Folha de pagamento", "Aluguel", "Equipamentos", "Outros"] },
      { key: "valor", label: "Valor (R$)", type: "number", min: "0.01", step: "0.01", required: true },
      { key: "data", label: "Data", type: "date", required: true },
      { key: "status", label: "Situação", type: "select", options: ["Pago", "Pendente"] }
    ],
    columns: [["descricao", "Descrição"], ["tipo", "Tipo"], ["categoria", "Categoria"], ["valor", "Valor"], ["data", "Data"], ["status", "Situação"]]
  }
};

const defaultState = () => ({ usuarios: [], clientes: [], funcionarios: [], financas: [], parcerias: [] });
let state = defaultState();
let activePage = "inicio";
let calendarDate = new Date();
let editingRecordId = null;
let toastTimeout;
let currentUser = null;
let isMaster = false;
let licenseExpired = false;

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.license_expired) {
      licenseExpired = true;
      if (isMaster) {
        activePage = "configuracoes";
        render();
      } else {
        showLogin(result.error);
      }
    }
    throw new Error(result.error || "Não foi possível concluir a operação.");
  }
  return result;
}

async function loadState() {
  const saved = await apiRequest("/api/records");
  state = Object.fromEntries(Object.keys(defaultState()).map((key) => {
    if (!Array.isArray(saved[key])) throw new Error(`Resposta inválida ao carregar ${key}.`);
    return [key, saved[key]];
  }));
}

function showRequestError(error) {
  console.error("Falha na comunicação com o servidor.", error);
  showToast(error.message || "Não foi possível conectar ao servidor.");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR").format(date);
}

function currency(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function displayValue(key, value) {
  if (!value) return "—";
  if (key === "imagem") return "";
  if (["nascimento", "vencimento", "admissao", "data"].includes(key)) return formatDate(value);
  if (key === "valor") return currency(value);
  return escapeHTML(value);
}

function pageHeading(title, description, buttonLabel, buttonAction) {
  return `<div class="page-heading"><div><span class="eyebrow">GESTÃO DA ACADEMIA</span><h1>${title}</h1><p>${description}</p></div>${buttonLabel ? `<button class="button button-primary" data-action="${buttonAction}">${buttonLabel} <span>＋</span></button>` : ""}</div>`;
}

function render() {
  const root = document.getElementById("page-content");
  const page = activePage;
  if (page === "inicio") root.innerHTML = renderDashboard();
  else if (page === "vencimentos" || page === "aniversarios") root.innerHTML = renderCalendar(page);
  else if (page === "planos") root.innerHTML = renderPlans();
  else if (page === "configuracoes" && isMaster) renderMasterSettings().catch(showRequestError);
  else if (SCHEMAS[page]) root.innerHTML = renderTable(page);
  document.getElementById("breadcrumb-current").textContent = page === "configuracoes" ? "Configurações master" : page === "inicio" ? "Visão geral" : page === "vencimentos" ? "Vencimentos" : page === "aniversarios" ? "Aniversários" : SCHEMAS[page]?.title || "Planos";
  document.querySelectorAll(".nav-link[data-page]").forEach((link) => link.classList.toggle("active", link.dataset.page === page));
  document.querySelectorAll(".main-nav .nav-link[data-page]").forEach((link) => {
    link.hidden = licenseExpired && link.dataset.page !== "configuracoes";
  });
}

function showLogin(message = "") {
  document.getElementById("app-shell").hidden = true;
  document.getElementById("auth-screen").hidden = false;
  document.getElementById("login-error").textContent = message;
}

async function startApplication() {
  const session = await apiRequest("/api/session");
  if (!session.authenticated) {
    showLogin();
    return;
  }
  currentUser = session.username;
  isMaster = session.is_master;
  licenseExpired = session.license_expired;
  if (licenseExpired && !isMaster) {
    showLogin("A disponibilidade do painel expirou. Procure o usuário master.");
    return;
  }

  document.getElementById("auth-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  document.getElementById("current-user").textContent = currentUser;
  document.getElementById("current-role").textContent = isMaster ? "Usuário master" : "Administrador";
  document.getElementById("master-nav").hidden = !isMaster;
  activePage = licenseExpired ? "configuracoes" : "inicio";
  if (!licenseExpired) await loadState();
  render();
}

async function renderMasterSettings() {
  const root = document.getElementById("page-content");
  root.innerHTML = `${pageHeading("Configurações master", "Controle a validade do painel e gerencie usuários administrativos.", null, null)}<p>Carregando configurações...</p>`;
  const [settings, userResult] = await Promise.all([
    apiRequest("/api/master/settings"),
    apiRequest("/api/master/users")
  ]);
  if (activePage !== "configuracoes") return;
  licenseExpired = settings.license_expired;
  const expiry = settings.license_expires_at || "";
  const users = userResult.users.map((user) => `<li>${escapeHTML(user.username)}</li>`).join("");
  root.innerHTML = `${pageHeading("Configurações master", "Controle a validade do painel e gerencie usuários administrativos.", null, null)}
    ${licenseExpired ? '<div class="license-notice"><strong>A validade do painel expirou.</strong> Atualize a data abaixo para liberar novamente o acesso administrativo.</div>' : ""}
    <div class="master-grid">
      <form class="panel master-form" id="license-form">
        <h2>Disponibilidade do painel</h2>
        <p>O site público continua acessível. Administradores ficam bloqueados após a data selecionada; o master sempre pode entrar para renovar.</p>
        <label for="license-expires-at">Disponível até</label>
        <input class="form-control" id="license-expires-at" name="license_expires_at" type="date" value="${escapeHTML(expiry)}">
        <button class="button button-primary" type="submit">Salvar validade <span>→</span></button>
        <button class="button button-quiet" id="remove-license-expiry" type="button">Remover limite de data</button>
      </form>
      <form class="panel master-form" id="admin-user-form">
        <h2>Cadastrar usuário administrativo</h2>
        <p>As senhas são armazenadas no banco somente como hash derivado; contas cadastradas aqui são removidas se o banco for apagado.</p>
        <label for="admin-username">Usuário</label>
        <input class="form-control" id="admin-username" name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9._-]+" autocomplete="off" required>
        <label for="admin-password">Senha (mínimo 12 caracteres)</label>
        <input class="form-control" id="admin-password" name="password" type="password" minlength="12" maxlength="1024" autocomplete="new-password" required>
        <button class="button button-primary" type="submit">Cadastrar administrador <span>＋</span></button>
        <h2 class="master-user-heading">Administradores cadastrados</h2>
        ${users ? `<ul class="master-user-list">${users}</ul>` : '<p>Nenhum administrador adicional cadastrado.</p>'}
      </form>
    </div>`;
  document.getElementById("license-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const expiresAt = document.getElementById("license-expires-at").value;
    try {
      const result = await apiRequest("/api/master/settings", {
        method: "PUT",
        body: JSON.stringify({ license_expires_at: expiresAt })
      });
      licenseExpired = result.license_expired;
      showToast("Validade do painel atualizada.");
      if (!licenseExpired) {
        await loadState();
        activePage = "inicio";
      }
      render();
    } catch (error) {
      showRequestError(error);
    }
  });
  document.getElementById("remove-license-expiry").addEventListener("click", () => {
    document.getElementById("license-expires-at").value = "";
    document.getElementById("license-form").requestSubmit();
  });
  document.getElementById("admin-user-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      await apiRequest("/api/master/users", {
        method: "POST",
        body: JSON.stringify(values)
      });
      showToast("Administrador cadastrado.");
      await renderMasterSettings();
    } catch (error) {
      showRequestError(error);
    }
  });
}

function renderDashboard() {
  const clients = state.clientes.length;
  const active = state.clientes.filter((client) => client.status !== "Inativo").length;
  const today = new Date();
  const monthTransactions = state.financas.filter((item) => {
    if (!item.data) return false;
    const date = new Date(`${item.data}T12:00:00`);
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear() && item.status !== "Pendente";
  });
  const income = monthTransactions.filter((item) => item.tipo === "Receita").reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const expenses = monthTransactions.filter((item) => item.tipo === "Despesa").reduce((sum, item) => sum + Number(item.valor || 0), 0);
  const soon = state.clientes.filter((client) => {
    if (!client.vencimento) return false;
    const days = Math.ceil((new Date(`${client.vencimento}T12:00:00`) - new Date(new Date().toDateString())) / 86400000);
    return days >= 0 && days <= 7 && client.status !== "Inativo";
  });
  return `
    <section class="hero-card">
      <div class="hero-copy"><span class="eyebrow">FORÇA, FOCO E SUPERAÇÃO</span><h1>Bem-vindo à Rocha Fitness</h1><p><strong>"O corpo alcança o que a mente acredita"</strong><br>Seu espaço para acompanhar a academia de perto.</p></div>
      <img class="hero-logo" src="assets/logo.jpg" alt="Rocha Fitness Academia">
    </section>
    <section class="stats-grid" aria-label="Resumo da academia">
      ${statCard("Alunos cadastrados", clients, "Total de clientes", "♙")}
      ${statCard("Alunos ativos", active, "Com matrícula ativa", "✓")}
      ${statCard("Vencimentos próximos", soon.length, "Próximos 7 dias", "◷")}
      ${statCard("Receita do mês", currency(income), `Despesas pagas: ${currency(expenses)}`, "R$")}
    </section>
    <section class="dashboard-grid">
      <div class="panel"><div class="panel-heading"><h2>Próximos vencimentos</h2><button class="text-link" data-page="vencimentos">Ver calendário →</button></div>
        ${soon.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>CLIENTE</th><th>PLANO</th><th>VENCIMENTO</th></tr></thead><tbody>${soon.slice(0, 5).map((client) => `<tr><td>${escapeHTML(client.nome)}</td><td>${escapeHTML(client.plano || "—")}</td><td>${formatDate(client.vencimento)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><span>◷</span>Nenhum vencimento nos próximos 7 dias.</div>`}
      </div>
      <div class="panel"><div class="panel-heading"><h2>Horários de funcionamento</h2></div><div class="hours-card"><h3>Esperamos por você</h3><div class="hours-row"><span>Segunda a sexta</span><strong>05h–12h · 14h–22h</strong></div><div class="hours-row"><span>Sábados e feriados</span><strong>08h–13h</strong></div><div class="hours-row"><span>Domingos</span><strong>Fechado</strong></div></div></div>
    </section>
    <section class="info-strip">
      <div class="info-card"><h3>Modalidades</h3><div class="tag-list">${["Musculação", "Funcional", "HIIT Core", "GAP", "Alongamento", "Fit Dance"].map((item) => `<span class="tag">${item}</span>`).join("")}</div></div>
      <div class="info-card"><h3>Empresas parceiras</h3><p class="partner-list">Escola Nacional Florestan Fernandes · Graal · Autopoli · ParaDouro Batistela · Organização Campo das Oliveiras · Kautex</p></div>
      <div class="info-card"><h3>Fale com a gente</h3><div class="social-line"><strong>Telefone:</strong> (12) 99610-2095<br><strong>E-mail:</strong> pedro.rocha10@hotmail.com<br><strong>Instagram:</strong> @ROCHAA_FITNESS · <strong>Facebook:</strong> rochaafitness</div></div>
    </section>
    <section class="info-strip"><div class="info-card" style="grid-column:1/-1"><h3>Onde estamos</h3><p class="partner-list">Padre Manoel da Nóbrega, 60 — Jardim Dulce, Guararema — SP, Brazil</p></div></section>`;
}

function statCard(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><strong>${value}</strong><small>${note}</small></article>`;
}

function renderTable(page) {
  const schema = SCHEMAS[page];
  const finances = page === "financas";
  const heading = pageHeading(schema.title, schema.description, `Novo ${schema.singular}`, "new-record");
  const total = state[page].length;
  if (finances) {
    const month = new Date();
    const transactions = state.financas.filter((item) => {
      if (!item.data) return false;
      const date = new Date(`${item.data}T12:00:00`);
      return date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear();
    });
    const income = transactions.filter((item) => item.tipo === "Receita" && item.status !== "Pendente").reduce((sum, item) => sum + Number(item.valor || 0), 0);
    const expenses = transactions.filter((item) => item.tipo === "Despesa" && item.status !== "Pendente").reduce((sum, item) => sum + Number(item.valor || 0), 0);
    return `${heading}<section class="finance-summary">${statCard("Receitas recebidas", currency(income), "Neste mês", "↗")}${statCard("Despesas pagas", currency(expenses), "Neste mês", "↘")}${statCard("Saldo do mês", currency(income - expenses), "Receitas menos despesas pagas", "R$")}</section>${renderDataTable(page, schema, total)}`;
  }
  return `${heading}${renderDataTable(page, schema, total)}`;
}

function renderDataTable(page, schema, total) {
  return `<section class="panel"><div class="panel-heading"><h2>Todos os registros</h2><span class="record-count">${total} ${total === 1 ? "registro" : "registros"}</span></div><div class="table-wrap"><table class="data-table"><thead><tr>${schema.columns.map(([, label]) => `<th>${label.toUpperCase()}</th>`).join("")}<th>AÇÕES</th></tr></thead><tbody id="table-body-${page}">${tableRows(page, schema)}</tbody></table></div></section>`;
}

function tableRows(page, schema, records = state[page]) {
  if (!records.length) return `<tr><td class="empty-table" colspan="${schema.columns.length + 1}">Nenhum registro cadastrado. Use o botão acima para começar.</td></tr>`;
  return records.map((record) => `<tr>${schema.columns.map(([key]) => `<td>${key === "imagem" && record[key] ? `<img class="table-image" src="${record[key]}" alt="Logo de ${escapeHTML(record.nome)}">` : badgeValue(key, record[key]) || displayValue(key, record[key])}</td>`).join("")}<td><div class="table-actions"><button class="mini-action" data-action="edit-record" data-id="${record.id}">Editar</button><button class="mini-action delete" data-action="delete-record" data-id="${record.id}">Excluir</button></div></td></tr>`).join("");
}

function badgeValue(key, value) {
  if (key === "status" && value) return `<span class="badge ${value === "Pago" || value === "Ativo" ? "badge-paid" : value === "Pendente" ? "badge-due" : ""}">${escapeHTML(value)}</span>`;
  if (key === "tipo" && value) return `<span class="badge ${value === "Receita" ? "badge-paid" : "badge-due"}">${escapeHTML(value)}</span>`;
  return "";
}

function renderPlans() {
  const plans = [
    { name: "Mensal", price: "R$ 94,90", installment: "Pagamento mensal", note: "Acesso por 1 mês" },
    { name: "Trimestral", price: "R$ 79,90", installment: "3× de R$ 79,90", note: "Total: R$ 239,70 · 3 meses" },
    { name: "Semestral", price: "R$ 69,90", installment: "6× de R$ 69,90", note: "Total: R$ 419,40 · 6 meses" },
    { name: "Casal", price: "R$ 169,90", installment: "Valor mensal para duas pessoas", note: "Acesso para o casal" }
  ];
  return `${pageHeading("Planos", "Escolha o plano ideal e acompanhe os valores da Rocha Fitness.", null, null)}<section class="plans-grid">${plans.map((plan) => `<article class="plan-card ${plan.name === "Semestral" ? "featured" : ""}"><span class="eyebrow">${plan.name === "Semestral" ? "MAIS VANTAGEM" : "PLANO ROCHA FITNESS"}</span><h2>${plan.name}</h2><div class="plan-price">${plan.price}<small>${plan.name === "Casal" ? "" : " /mês"}</small></div><p class="plan-installment">${plan.installment}</p><div class="plan-note">${plan.note}</div></article>`).join("")}</section><div class="membership-note">Adesão de matrícula: <strong>R$ 30,00</strong></div><section class="info-strip" style="grid-template-columns:1fr;margin-top:16px"><div class="info-card"><h3>Modalidades incluídas</h3><div class="tag-list">${["Musculação", "Funcional", "HIIT Core", "GAP", "Alongamento", "Fit Dance"].map((item) => `<span class="tag">${item}</span>`).join("")}</div></div></section>`;
}

function getCalendarEntries(page) {
  if (page === "vencimentos") {
    return state.clientes.filter((client) => client.vencimento).map((client) => ({ date: client.vencimento, label: client.nome, type: "due" }));
  }
  return state.clientes.filter((client) => client.nascimento).map((client) => {
    const birth = new Date(`${client.nascimento}T12:00:00`);
    const date = `${calendarDate.getFullYear()}-${String(birth.getMonth() + 1).padStart(2, "0")}-${String(birth.getDate()).padStart(2, "0")}`;
    return { date, label: client.nome, type: "birthday" };
  });
}

function renderCalendar(page) {
  const isBirthday = page === "aniversarios";
  const title = isBirthday ? "Aniversários" : "Vencimentos";
  const description = isBirthday ? "Celebre os alunos da Rocha Fitness e não deixe nenhuma data passar." : "Acompanhe as mensalidades e fique de olho nos próximos vencimentos.";
  const entries = getCalendarEntries(page);
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const previousMonthDays = new Date(year, month, 0).getDate();
  const cells = [];
  WEEKDAYS.forEach((day) => cells.push(`<div class="weekday">${day}</div>`));
  for (let index = 0; index < 42; index++) {
    let day, cellMonth = month, cellYear = year, otherMonth = false;
    if (index < firstDay) {
      day = previousMonthDays - firstDay + index + 1;
      cellMonth = month - 1;
      otherMonth = true;
    } else if (index >= firstDay + daysInMonth) {
      day = index - firstDay - daysInMonth + 1;
      cellMonth = month + 1;
      otherMonth = true;
    } else {
      day = index - firstDay + 1;
    }
    if (cellMonth < 0) { cellMonth = 11; cellYear -= 1; }
    if (cellMonth > 11) { cellMonth = 0; cellYear += 1; }
    const isoDate = `${cellYear}-${String(cellMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const matching = entries.filter((entry) => entry.date === isoDate);
    const today = new Date();
    const isToday = !otherMonth && year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
    cells.push(`<div class="calendar-day ${otherMonth ? "other-month" : ""} ${isToday ? "today" : ""}"><span class="day-number">${day}</span>${matching.map((entry) => `<div class="calendar-event ${entry.type === "birthday" ? "birthday" : ""}" title="${escapeHTML(entry.label)}">${escapeHTML(entry.label)}</div>`).join("")}</div>`);
  }
  return `${pageHeading(title, description, null, null)}<section class="panel"><div class="panel-heading"><div class="calendar-controls"><button class="calendar-nav" data-action="previous-month" aria-label="Mês anterior">‹</button><span class="month-label">${MONTHS[month]} ${year}</span><button class="calendar-nav" data-action="next-month" aria-label="Próximo mês">›</button></div><button class="button button-primary button-small" data-page="clientes">Ver clientes <span>→</span></button></div><div class="calendar-grid">${cells.join("")}</div><div class="calendar-legend"><span><i class="legend-dot"></i>${isBirthday ? "Aniversariante" : "Vencimento da mensalidade"}</span>${isBirthday ? "" : "<span>Cadastre ou atualize os clientes para preencher o calendário.</span>"}</div></section>`;
}

function openForm(page, record = null) {
  const schema = SCHEMAS[page];
  if (!schema) return;
  editingRecordId = record?.id || null;
  document.getElementById("dialog-title").textContent = record ? `Editar ${schema.singular}` : `Novo ${schema.singular}`;
  document.getElementById("form-fields").innerHTML = schema.fields.map((field) => {
    const type = field.type || "text";
    const value = record?.[field.key] || "";
    const options = field.options ? `<option value="">Selecione</option>${field.options.map((option) => `<option value="${escapeHTML(option)}" ${value === option ? "selected" : ""}>${escapeHTML(option)}</option>`).join("")}` : "";
    const control = field.image
      ? `<input class="form-control" id="field-${field.key}" name="${field.key}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" ${field.required && !record?.[field.key] ? "required" : ""}><small class="field-help">${record?.[field.key] ? "Selecione outra imagem para substituir a atual." : "A imagem será exibida junto ao nome da empresa no site público."}</small>`
      : field.options
      ? `<select class="form-control" id="field-${field.key}" name="${field.key}" ${field.required ? "required" : ""}>${options}</select>`
      : `<input class="form-control" id="field-${field.key}" name="${field.key}" type="${type}" value="${escapeHTML(value)}" ${field.required ? "required" : ""} ${field.min ? `min="${field.min}"` : ""} ${field.step ? `step="${field.step}"` : ""}>`;
    return `<div class="field ${field.full ? "full" : ""}"><label for="field-${field.key}">${field.label}${field.required ? " *" : ""}</label>${control}</div>`;
  }).join("");
  const dialog = document.getElementById("form-dialog");
  dialog.dataset.page = page;
  dialog.showModal();
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
}

function navigate(page) {
  if (licenseExpired && page !== "configuracoes") return;
  if (page === "configuracoes" && !isMaster) return;
  activePage = page;
  if (["usuarios", "clientes", "funcionarios", "parcerias"].includes(page)) {
    document.getElementById("cadastros-submenu").classList.add("submenu");
    document.getElementById("cadastros-toggle").setAttribute("aria-expanded", "true");
  }
  render();
  document.getElementById("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.id === "cadastros-toggle") {
    const expanded = target.getAttribute("aria-expanded") === "true";
    target.setAttribute("aria-expanded", String(!expanded));
    document.getElementById("cadastros-submenu").hidden = expanded;
    return;
  }
  if (target.id === "mobile-menu") {
    document.getElementById("sidebar").classList.toggle("open");
    return;
  }
  if (target.dataset.page) {
    event.preventDefault();
    navigate(target.dataset.page);
    return;
  }
  const action = target.dataset.action;
  if (action === "new-record") openForm(activePage);
  if (action === "edit-record") {
    const record = state[activePage].find((item) => item.id === target.dataset.id);
    if (record) openForm(activePage, record);
  }
  if (action === "delete-record") {
    const record = state[activePage].find((item) => item.id === target.dataset.id);
    if (!record || !window.confirm(`Excluir o registro "${record.nome || record.descricao}"?`)) return;
    apiRequest(`/api/records/${activePage}/${encodeURIComponent(record.id)}`, { method: "DELETE" })
      .then(() => {
        state[activePage] = state[activePage].filter((item) => item.id !== record.id);
        render();
        showToast("Registro excluído.");
      })
      .catch(showRequestError);
  }
  if (action === "previous-month") { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1); render(); }
  if (action === "next-month") { calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1); render(); }
});

document.getElementById("record-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const page = document.getElementById("form-dialog").dataset.page;
  try {
    const values = Object.fromEntries(new FormData(form).entries());
    const imageInput = form.elements.namedItem("imagem");
    if (imageInput instanceof HTMLInputElement && imageInput.type === "file") {
      const imageFile = imageInput.files[0];
      if (imageFile) {
        if (imageFile.size > 700 * 1024) throw new Error("A imagem deve ter no máximo 700 KB.");
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageFile.type)) {
          throw new Error("Selecione uma imagem JPEG, PNG, WebP ou GIF.");
        }
        values.imagem = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(reader.result));
          reader.addEventListener("error", () => reject(new Error("Não foi possível ler a imagem selecionada.")));
          reader.readAsDataURL(imageFile);
        });
      } else if (editingRecordId) {
        values.imagem = state[page].find((record) => record.id === editingRecordId)?.imagem || "";
      }
    }
    if (values.valor) values.valor = Number(values.valor).toFixed(2);
    const path = `/api/records/${page}${editingRecordId ? `/${encodeURIComponent(editingRecordId)}` : ""}`;
    const result = await apiRequest(path, {
      method: editingRecordId ? "PUT" : "POST",
      body: JSON.stringify(values)
    });
    if (editingRecordId) {
      state[page] = state[page].map((record) => record.id === editingRecordId ? result.record : record);
    } else {
      state[page].unshift(result.record);
    }
    document.getElementById("form-dialog").close();
    render();
    showToast(editingRecordId ? "Cadastro atualizado com sucesso." : "Cadastro salvo com sucesso.");
  } catch (error) {
    showRequestError(error);
  }
});

document.getElementById("close-dialog").addEventListener("click", () => document.getElementById("form-dialog").close());
document.getElementById("cancel-dialog").addEventListener("click", () => document.getElementById("form-dialog").close());
document.getElementById("today-label").textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form).entries());
  document.getElementById("login-error").textContent = "";
  try {
    await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify(values)
    });
    form.reset();
    await startApplication();
  } catch (error) {
    document.getElementById("login-error").textContent = error.message;
  }
});
document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    await apiRequest("/api/logout", { method: "POST" });
    currentUser = null;
    isMaster = false;
    licenseExpired = false;
    showLogin();
  } catch (error) {
    showRequestError(error);
  }
});
startApplication().catch((error) => showLogin(error.message));
