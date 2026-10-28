const fallbackPartners = [
  "Escola Nacional Florestan Fernandes",
  "Graal",
  "Autopoli",
  "ParaDouro Batistela",
  "Organização Campo das Oliveiras",
  "Kautex"
];

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

async function loadPartners() {
  const grid = document.getElementById("partners-grid");
  try {
    const response = await fetch("/api/public/parcerias");
    if (!response.ok) throw new Error("Não foi possível carregar as parcerias.");
    const partners = await response.json();
    const entries = Array.isArray(partners) && partners.length
      ? partners
      : fallbackPartners.map((nome) => ({ nome, descricao: "" }));
    grid.innerHTML = entries.map((partner) => `
      <article class="partner-card">
        ${partner.imagem
          ? `<img class="partner-image" src="${partner.imagem}" alt="Logo de ${escapeHTML(partner.nome)}">`
          : `<span class="partner-image" aria-hidden="true">${initials(partner.nome)}</span>`}
        <div><strong>${escapeHTML(partner.nome)}</strong>${partner.descricao ? `<small>${escapeHTML(partner.descricao)}</small>` : "<small>Empresa parceira Rocha Fitness</small>"}</div>
      </article>`).join("");
  } catch (error) {
    console.error(error);
    grid.innerHTML = `<p class="partners-loading">Nossas empresas parceiras: ${fallbackPartners.map(escapeHTML).join(" · ")}</p>`;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

document.getElementById("current-year").textContent = String(new Date().getFullYear());
document.getElementById("public-menu-toggle").addEventListener("click", (event) => {
  const menu = document.querySelector(".site-nav");
  const open = menu.classList.toggle("open");
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
document.querySelectorAll(".site-nav a").forEach((link) => link.addEventListener("click", () => {
  document.querySelector(".site-nav").classList.remove("open");
  document.getElementById("public-menu-toggle").setAttribute("aria-expanded", "false");
}));
loadPartners();
