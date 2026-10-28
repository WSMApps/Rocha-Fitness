function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

async function loadGympass() {
  const grid = document.getElementById("partners-grid");
  try {
    const response = await fetch("/api/public/parcerias");
    if (!response.ok) throw new Error("Não foi possível carregar a parceria Gympass.");
    const partners = await response.json();
    if (!Array.isArray(partners)) throw new Error("Resposta inválida ao carregar a parceria Gympass.");
    const gympass = partners.find((partner) =>
      typeof partner.nome === "string" && partner.nome.toLowerCase() === "gympass"
    );
    if (gympass) {
      grid.insertAdjacentHTML("beforeend", `
        <article class="partner-card">
          ${gympass.imagem
            ? `<img class="partner-image" src="${escapeHTML(gympass.imagem)}" alt="Logotipo Gympass">`
            : `<span class="partner-image" aria-hidden="true">${initials(gympass.nome)}</span>`}
          <div><strong>${escapeHTML(gympass.nome)}</strong>${gympass.descricao ? `<small>${escapeHTML(gympass.descricao)}</small>` : "<small>Empresa parceira Rocha Fitness</small>"}</div>
        </article>`);
    }
  } catch (error) {
    console.error(error);
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
loadGympass();
