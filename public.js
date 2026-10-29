const supabaseConfig = window.ROCHA_SUPABASE_CONFIG || {};
const supabaseUrl = typeof supabaseConfig.url === "string" ? supabaseConfig.url.trim() : "";
const supabaseAnonKey = typeof supabaseConfig.anonKey === "string" ? supabaseConfig.anonKey.trim() : "";
const hasSupabaseConfig = Boolean(supabaseUrl || supabaseAnonKey);
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
