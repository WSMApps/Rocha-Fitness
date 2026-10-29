function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

const supabaseConfig = window.ROCHA_SUPABASE_CONFIG || {};
const supabaseUrl = typeof supabaseConfig.url === "string" ? supabaseConfig.url.trim() : "";
const supabaseAnonKey = typeof supabaseConfig.anonKey === "string" ? supabaseConfig.anonKey.trim() : "";
const hasSupabaseConfig = Boolean(supabaseUrl || supabaseAnonKey);
const supabaseClient = hasSupabaseConfig
  && supabaseUrl
  && supabaseAnonKey
  && typeof window.supabase?.createClient === "function"
  ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
  : null;

async function loadGympass() {
  const grid = document.getElementById("partners-grid");
  try {
    let partners;
    if (supabaseClient) {
      const { data, error } = await supabaseClient
        .from("public_partners")
        .select("name, description, image");
      if (error) throw new Error(error.message);
      partners = data.map((partner) => ({
        nome: partner.name,
        descricao: partner.description,
        imagem: partner.image
      }));
    } else {
      if (hasSupabaseConfig) {
        throw new Error("A configuração pública do Supabase está incompleta ou a biblioteca não carregou.");
      }
      const response = await fetch("/api/public/parcerias");
      if (!response.ok) throw new Error("Não foi possível carregar a parceria Gympass.");
      partners = await response.json();
    }
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

document.querySelectorAll(".admin-button").forEach((link) => {
  link.addEventListener("click", async (event) => {
    if (
      event.button !== 0
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    if (hasSupabaseConfig) {
      window.location.assign("admin.html");
      return;
    }
    try {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("Backend indisponível.");
      const health = await response.json();
      if (health.status !== "ok") throw new Error("Resposta de saúde inválida.");
      window.location.assign("/admin");
    } catch (error) {
      console.info("Backend indisponível; abrindo o painel de demonstração.", error);
      window.location.assign("admin.html?demo=1");
    }
  });
});

document.getElementById("current-year").textContent = String(new Date().getFullYear());
loadGympass();
